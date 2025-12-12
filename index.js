import 'dotenv/config';
import pkg from 'discord.js';
const { Client, GatewayIntentBits, Routes, PermissionFlagsBits, ChannelType, Interaction, MessageFlags } = pkg;
import { REST } from '@discordjs/rest';
import fetch from 'node-fetch';
import Canvas from 'canvas';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
// Bot startup time tracker
const BOT_START_TIME = Date.now();

// Einfacher HTTP-Server für Replit / Uptime pings
const app = express();
app.get('/', (req, res) => res.send('Beast Bot ist online'));
app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HTTP-Server läuft auf Port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
});

// Global error handlers — prevent process from crashing on Discord API timing issues
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason && (reason.stack || reason));
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err && (err.stack || err));
});
client.on('error', (err) => {
    console.error('Discord client error:', err && (err.stack || err));
});

// Early guard: block commands that have been disabled via /owner disable (persisted in guild-config.json)
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;
        const cmd = interaction.commandName;
        const cfg = await loadConfig();
        const gcfg = (interaction.guild && cfg[interaction.guild.id]) ? cfg[interaction.guild.id] : {};

        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        const normalize = s => String(s || '').replace(/^\/*/, '').trim().toLowerCase();
        const globalDisabled = (cfg._global && Array.isArray(cfg._global.disabledCommands)) ? cfg._global.disabledCommands.map(x=>normalize(x)) : [];
        let subName = '';
        try { subName = interaction.options.getSubcommand(false) || ''; } catch(_) { subName = ''; }
        const checkNames = [normalize(cmd)];
        if (subName) checkNames.push(`${normalize(cmd)} ${normalize(subName)}`);
        if (checkNames.some(n => globalDisabled.includes(n)) && !isOwner) {
            try { console.log('DEBUG: blocking global disabled cmd', checkNames, 'for', interaction.user.tag); } catch(_){ }
            if (!interaction.replied && !interaction.deferred) {
                try { return interaction.reply({ content: '⛔ Dieser Befehl ist momentan deaktiviert — vom Owner gesperrt. 🔒', flags: MessageFlags.Ephemeral }); } catch(err) { console.warn('early guard reply failed', err && err.message); return; }
            } else {
                try { console.warn('Guard: cannot reply, interaction already acknowledged'); } catch(_){}
                return;
            }
        }

        const guildDisabled = (gcfg && Array.isArray(gcfg.disabledCommands)) ? gcfg.disabledCommands.map(x=>normalize(x)) : [];
        if (checkNames.some(n => guildDisabled.includes(n)) && !isOwner && !(interaction.member && interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))) {
             try { console.log('DEBUG: blocking guild disabled cmd', checkNames, 'in guild', interaction.guild?.id, 'for', interaction.user.tag); } catch(_){ }
             if (!interaction.replied && !interaction.deferred) {
                 try { return interaction.reply({ content: '⚠️ Dieser Befehl wurde für diesen Server deaktiviert. Bitte kontaktiere einen Server-Admin oder Owner. 🔧', flags: MessageFlags.Ephemeral }); } catch(err) { console.warn('early guard reply failed', err && err.message); return; }
             } else {
                 try { console.warn('Guard: cannot reply, interaction already acknowledged'); } catch(_){}
                 return;
             }
        }
    } catch (e) {
        console.error('disabled guard error', e && e.message);
    }
});

// Global guard: block disabled commands early and show a friendly error
client.on('interactionCreate', async interaction => {
    try {
        if (!interaction.isChatInputCommand()) return;
        const cmd = interaction.commandName;
        const cfg = await loadConfig();
        const gcfg = (interaction.guild && cfg[interaction.guild.id]) ? cfg[interaction.guild.id] : {};

        // gather owners (owners bypass disables)
        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        // check global and guild-scoped disabled lists (normalize stored values)
        const normalize = s => String(s || '').replace(/^\/*/, '').trim().toLowerCase();
        const globalDisabled = (cfg._global && Array.isArray(cfg._global.disabledCommands)) ? cfg._global.disabledCommands.map(x=>normalize(x)) : [];
        let subName = '';
        try { subName = interaction.options.getSubcommand(false) || ''; } catch(_) { subName = ''; }
        const checkNames = [normalize(cmd)];
        if (subName) checkNames.push(`${normalize(cmd)} ${normalize(subName)}`);
        if (checkNames.some(n => globalDisabled.includes(n)) && !isOwner) {
            try { return interaction.reply({ content: '⛔ Dieser Befehl ist momentan deaktiviert — vom Owner gesperrt. Bitte wende dich an den Owner.', flags: MessageFlags.Ephemeral }); } catch(_) { return; }
        }

        const guildDisabled = (gcfg && Array.isArray(gcfg.disabledCommands)) ? gcfg.disabledCommands.map(x=>normalize(x)) : [];
        if (checkNames.some(n => guildDisabled.includes(n)) && !isOwner && !(interaction.member && interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))) {
            try { return interaction.reply({ content: '⚠️ Dieser Befehl wurde für diesen Server deaktiviert. Kontaktiere einen Server-Admin oder Owner.', flags: MessageFlags.Ephemeral }); } catch(_) { return; }
        }
    } catch (e) {
        console.error('disabled-guard error', e && e.message);
    }
});

    // Animated /hack handler: edits reply progressively to look "cool"
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.__blocked) return;
        if (interaction.commandName !== 'hack') return;

        // Admin or owner only
        const cfg = await loadConfig();
        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        const isOwner = owners.has(interaction.user.id);
        if (!interaction.member || !interaction.member.permissions || (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner)) {
            return interaction.reply({ content: 'Nur Server-Admins dürfen diesen simulierten Befehl verwenden.', flags: MessageFlags.Ephemeral });
        }

        const target = interaction.options.getUser('user');
        if (!target) return interaction.reply({ content: 'Bitte gib ein Ziel an (User).', flags: MessageFlags.Ephemeral });

        try {
            await interaction.deferReply();
        } catch (e) {
            console.error('/hack: deferReply failed', e);
            try { await interaction.reply({ content: 'Fehler beim Starten der Simulation.', flags: MessageFlags.Ephemeral }); } catch(_){}
            return;
        }

        const frames = ['⠁','⠂','⠄','⡀','⢀','⠠','⠐','⠈'];
        // helper to safely edit the deferred reply; reuses a single message to avoid spamming followUps
        let lastBotMessage = null;
        let channelFallbackMessage = null;
        const safeEdit = async (payload) => {
            const content = typeof payload === 'string' ? payload : (payload && payload.content) || '';
            try {
                if (lastBotMessage) {
                    await lastBotMessage.edit(typeof payload === 'string' ? { content } : payload);
                    return true;
                }
                // try to edit the original interaction reply
                await interaction.editReply(typeof payload === 'string' ? { content } : payload);
                try {
                    lastBotMessage = await interaction.fetchReply();
                } catch (fetchErr) {
                    // not critical, we'll use followUp as a single fallback
                    console.warn('/hack: fetchReply failed after editReply', fetchErr && fetchErr.message);
                }
                return true;
            } catch (err) {
                console.error('/hack: editReply/lastBotMessage.edit failed', err && err.message);
                // use a single followUp message (create once, then edit it)
                try {
                    if (channelFallbackMessage) {
                        await channelFallbackMessage.edit({ content });
                        return true;
                    }
                    // create a followUp and keep reference
                    channelFallbackMessage = await interaction.followUp({ content, fetchReply: true });
                    return true;
                } catch (err2) {
                    console.error('/hack: followUp/edit fallback failed', err2 && err2.message);
                    try {
                        // final fallback: send one channel message and reuse it
                        if (channelFallbackMessage && channelFallbackMessage.channel) {
                            await channelFallbackMessage.channel.send(content);
                            return true;
                        }
                        const sent = await interaction.channel.send(content);
                        channelFallbackMessage = sent;
                        return true;
                    } catch (err3) {
                        console.error('/hack: channel.send fallback failed', err3 && err3.message);
                        return false;
                    }
                }
            }
        };
        const steps = [
            { text: 'Initialisiere Verbindung', pct: 8 },
            { text: 'Handshake & Fingerprint', pct: 18 },
            { text: 'Firewall-Bypass', pct: 34 },
            { text: 'Ports scannen', pct: 46 },
            { text: 'Exploit vorbereiten', pct: 60 },
            { text: 'Payload übertragen', pct: 74 },
            { text: 'Sitzung aufbauen', pct: 88 },
            { text: 'Daten extrahieren', pct: 98 }
        ];

        // initial reply — ensure we actually have a message to edit, otherwise abort
        const initialOk = await safeEdit('🔒 Starte Hack-Simulation...');
        if (!initialOk) {
            console.error('/hack: initial message could not be created; aborting animation to avoid indefinite thinking state');
            try {
                await interaction.followUp({ content: 'Fehler: Bot kann keine Nachrichten senden. Abbruch.', flags: MessageFlags.Ephemeral });
            } catch (e) {
                try { await interaction.channel.send('Fehler: Bot kann keine Nachrichten senden. Bitte prüfe Berechtigungen.'); } catch (_) { }
            }
            return;
        }

        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            const blocks = Math.floor((s.pct / 100) * 24);
            const bar = '█'.repeat(blocks) + '░'.repeat(24 - blocks);
            // show a few spinner frames per step
            for (let f = 0; f < 3; f++) {
                const frame = frames[(i + f) % frames.length];
                const content = frame + '  ' + '【' + target.tag + '】  ' + s.text + '\n' + '```' + bar + ' ' + s.pct + '%```' + '\n' + '_Status: running..._';
                const ok = await safeEdit({ content });
                if (!ok) console.warn('/hack: could not send update for step', i, 'frame', f);
                await sleep(180 + Math.floor(Math.random() * 220));
            }
        }

        // final reveal
        const fakePasswords = ['1234','password','qwerty','letmein','P@ssw0rd','hunter2','iloveyou','dragon','sunshine'];
        const found = fakePasswords[Math.floor(Math.random() * fakePasswords.length)];
        await safeEdit('✅ Zugriff erlangt auf ' + target.tag + ' — Ergebnisse werden vorbereitet...');
        await sleep(650);
        try {
            await interaction.followUp({ content: '🔑 Gefundenes Passwort: `' + found + '` (Nur Spaß! 🔒)', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('/hack: final followUp failed', e && e.message);
            try { await interaction.channel.send({ content: '🔑 Gefundenes Passwort: ' + found + ' (Nur Spaß!)' }); } catch(_){ console.error('/hack: final channel.send failed'); }
        }
        return;
    });

// Handler: /setup -> create server layout + roles
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    if (interaction.commandName !== 'setup') return;

    if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', flags: MessageFlags.Ephemeral });
    }

    const typ = interaction.options.getString('typ');
    const createRoles = !!interaction.options.getBoolean('roles');
    if (!interaction.guild) return interaction.reply({ content: 'Dieser Befehl muss in einem Server verwendet werden.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const created = { channels: [], roles: [], categoryId: null };

    // Helper: promise with timeout to avoid hanging operations
    const withTimeout = (p, ms = 8000) => {
        return Promise.race([
            p,
            new Promise((_, reject) => setTimeout(() => reject(new Error('operation timeout')), ms))
        ]);
    };

    // Check bot permissions before proceeding
    try {
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(client.user.id);
        const missing = [];
        if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('ManageChannels');
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) missing.push('ManageRoles');
        if (!botMember.permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('ViewChannel');
        if (missing.length) {
            return interaction.editReply({ content: `Ich benötige folgende Berechtigungen, um ein Setup anzulegen: ${missing.join(', ')}. Bitte passe die Bot-Berechtigungen an und versuche es erneut.` });
        }
    } catch (e) {
        console.warn('permission check failed', e && e.message);
    }
    try {
        // Create a category for the setup (use timeout to avoid hanging)
        await interaction.editReply({ content: 'Erstelle Kategorie...' });
        const catName = `Beast • ${typ.charAt(0).toUpperCase() + typ.slice(1)}`;
        let category = null;
        try {
            category = await withTimeout(guild.channels.create({ name: catName, type: ChannelType.GuildCategory, reason: 'Setup durch /setup' }), 9000);
            if (!category) throw new Error('Keine Kategorie zurückgegeben');
            created.categoryId = category.id;
        } catch (e) {
            console.warn('category create failed', e && e.message);
            try { await interaction.editReply({ content: `Fehler: Konnte Kategorie nicht erstellen: ${e.message || String(e)}. Prüfe Bot-Berechtigungen oder versuche es später.` }); } catch (_) {}
            return;
        }
        await sleep(200);

        // Define common roles and style-specific roles
        const baseRoles = [
            { name: 'Admin', color: '#ff0000' },
            { name: 'Moderator', color: '#ff8800' },
            { name: 'Member', color: '#00ff88' }
        ];
        const styleRoles = {
            gaming: [{ name: 'Gamer', color: '#8b00ff' }],
            community: [{ name: 'Community', color: '#0077ff' }],
            musik: [{ name: 'Musiker', color: '#ff00aa' }],
            streamer: [{ name: 'Streamer', color: '#00d4ff' }, { name: 'Subscriber', color: '#ffd700' }]
        };

        // Create roles (skip if they exist) — can be disabled via the `roles` option
        if (createRoles) {
            await interaction.editReply({ content: 'Erstelle Rollen...' });
            for (let i = 0; i < baseRoles.length; i++) {
                const r = baseRoles[i];
                let existing = guild.roles.cache.find(x => x.name === r.name);
                if (!existing) {
                    try {
                        existing = await withTimeout(guild.roles.create({ name: r.name, color: r.color, reason: 'Setup roles' }), 8000);
                    } catch (e) {
                        console.warn('role create failed', r.name, e && e.message);
                    }
                }
                if (existing) created.roles.push(existing.id);
                // update progress so interaction stays alive and user sees progress
                try { await interaction.editReply({ content: `Erstelle Rollen... (${i + 1}/${baseRoles.length})` }); } catch (_) {}
                await sleep(120);
            }
            const extras = styleRoles[typ] || [];
            for (let i = 0; i < extras.length; i++) {
                const r = extras[i];
                let existing = guild.roles.cache.find(x => x.name === r.name);
                if (!existing) {
                    try {
                        existing = await withTimeout(guild.roles.create({ name: r.name, color: r.color, reason: 'Setup style role' }), 8000);
                    } catch (e) {
                        console.warn('style role create failed', r.name, e && e.message);
                    }
                }
                if (existing) created.roles.push(existing.id);
                try { await interaction.editReply({ content: `Erstelle style-Rollen... (${i + 1}/${extras.length})` }); } catch (_) {}
                await sleep(120);
            }
        } else {
            try { await interaction.editReply({ content: 'Rollen werden übersprungen (nur Struktur wird erstellt)...' }); } catch(_) {}
        }

        // Create some channels per type under the category
        const makeText = async (name, idx, total) => {
            try {
                const ch = await withTimeout(guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, reason: 'Setup channel' }), 9000);
                if (ch) created.channels.push(ch.id);
                try { await interaction.editReply({ content: `Erstelle Channels... (${idx}/${total})` }); } catch (_) {}
                await sleep(80);
                return ch;
            } catch (e) {
                console.warn('create channel failed', name, e && e.message);
            }
        };

        // common channels (with emoji prefixes for nicer appearance)
        const commonChannels = ['👋-welcome', '📜-rules', '📣-announcements', '💬-general'];
        await interaction.editReply({ content: 'Erstelle Channels...' });
        for (let i = 0; i < commonChannels.length; i++) {
            await makeText(commonChannels[i], i + 1, commonChannels.length);
        }

        if (typ === 'gaming') {
            await makeText('🎯-matchmaking', 1, 4);
            await makeText('🎬-clips', 2, 4);
            await makeText('🕹️-looking-for-group', 3, 4);
            try { const v1 = await withTimeout(guild.channels.create({ name: 'Gaming 1', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v1) created.channels.push(v1.id); } catch(e){console.warn('voice create failed', e && e.message);} 
            try { const v2 = await withTimeout(guild.channels.create({ name: 'Gaming 2', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v2) created.channels.push(v2.id); } catch(e){console.warn('voice create failed', e && e.message);} 
        } else if (typ === 'community') {
            await makeText('🙋-introductions', 1, 4);
            await makeText('🎉-events', 2, 4);
            await makeText('☕-off-topic', 3, 4);
            try { const v1 = await withTimeout(guild.channels.create({ name: 'Lounge 1', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v1) created.channels.push(v1.id); } catch(e){console.warn('voice create failed', e && e.message);} 
            try { const v2 = await withTimeout(guild.channels.create({ name: 'Lounge 2', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v2) created.channels.push(v2.id); } catch(e){console.warn('voice create failed', e && e.message);} 
        } else if (typ === 'musik') {
            await makeText('🎵-tracks', 1, 4);
            await makeText('🎼-playlists', 2, 4);
            await makeText('🎤-requests', 3, 4);
            try { const v1 = await withTimeout(guild.channels.create({ name: 'Lounge', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v1) created.channels.push(v1.id); } catch(e){console.warn('voice create failed', e && e.message);} 
            try { const v2 = await withTimeout(guild.channels.create({ name: 'Karaoke', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v2) created.channels.push(v2.id); } catch(e){console.warn('voice create failed', e && e.message);} 
        } else if (typ === 'streamer') {
            await makeText('🔴-live-updates', 1, 4);
            await makeText('🎞️-clips', 2, 4);
            await makeText('⭐-supporters', 3, 4);
            try { const v1 = await withTimeout(guild.channels.create({ name: 'Stream Voice', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v1) created.channels.push(v1.id); } catch(e){console.warn('voice create failed', e && e.message);} 
            try { const v2 = await withTimeout(guild.channels.create({ name: 'Guest', type: ChannelType.GuildVoice, parent: category.id, reason: 'Setup voice' }), 9000); if (v2) created.channels.push(v2.id); } catch(e){console.warn('voice create failed', e && e.message);} 
        }

        // Save created IDs to config
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].setup = { created, style: typ };
        await saveConfig(cfg);

        return interaction.editReply({ content: `Setup '${typ}' abgeschlossen. Angelegte Channels: ${created.channels.length}, Rollen: ${created.roles.length}.` });
    } catch (e) {
        console.error('/setup error', e);
        return interaction.editReply({ content: `Fehler beim Erstellen des Setups: ${e.message || String(e)}` });
    }
});

// Handler: /setup-delete -> remove previously created setup (Admin only)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    if (interaction.commandName !== 'setup-delete') return;

    if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.guild) return interaction.reply({ content: 'Dieser Befehl muss in einem Server verwendet werden.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ ephemeral: true });
    try {
        const cfg = await loadConfig();
        const gcfg = cfg[interaction.guild.id] || {};
        if (!gcfg.setup || !gcfg.setup.created) return interaction.editReply({ content: 'Kein gespeichertes Setup für diesen Server gefunden.' });

        const created = gcfg.setup.created;
        const results = { channels: 0, roles: 0 };

        // Delete channels
        for (const cid of (created.channels || [])) {
            try {
                const ch = await interaction.guild.channels.fetch(cid).catch(()=>null);
                if (ch) { await ch.delete('Cleanup setup'); results.channels++; }
            } catch (e) { console.warn('failed to delete channel', cid, e && e.message); }
            await sleep(120);
        }

        // Delete category
        if (created.categoryId) {
            try { const cat = await interaction.guild.channels.fetch(created.categoryId).catch(()=>null); if (cat) { await cat.delete('Cleanup setup category'); } } catch(e){/*ignore*/}
        }

        // Delete roles
        for (const rid of (created.roles || [])) {
            try {
                const role = await interaction.guild.roles.fetch(rid).catch(()=>null);
                if (role) { await role.delete('Cleanup setup role'); results.roles++; }
            } catch (e) { console.warn('failed to delete role', rid, e && e.message); }
            await sleep(150);
        }

        // Remove setup entry from config
        delete gcfg.setup;
        cfg[interaction.guild.id] = gcfg;
        await saveConfig(cfg);

        return interaction.editReply({ content: `Setup entfernt. Gelöschte Channels: ${results.channels}, gelöschte Rollen: ${results.roles}.` });
    } catch (e) {
        console.error('/setup-delete error', e);
        return interaction.editReply({ content: `Fehler beim Entfernen des Setups: ${e.message || String(e)}` });
    }
});

// Handler: /shoutout -> generate a shoutout graphic for a user
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    if (interaction.commandName !== 'shoutout') return;

    const target = interaction.options.getUser('user');
    const text = interaction.options.getString('message') || '';
    if (!target) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });

    await interaction.deferReply();
    try {
        // load avatar
        const avatarURL = target.displayAvatarURL({ extension: 'png', size: 512 });
        const avatarImg = await Canvas.loadImage(avatarURL);

        const width = 1200; const height = 630;
        const canvas = Canvas.createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // background gradient
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, '#ff5f6d');
        grad.addColorStop(1, '#ffc371');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // dark overlay for contrast
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, width, height);

        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 72px Sans';
        ctx.textAlign = 'left';
        ctx.fillText('SHOUTOUT', 60, 110);

        // Draw avatar circle
        const avSize = 320;
        const avX = 60;
        const avY = 150;
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avSize/2, avY + avSize/2, avSize/2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, avX, avY, avSize, avSize);
        ctx.restore();

        // Username
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 48px Sans';
        ctx.textAlign = 'left';
        ctx.fillText(target.username, avX + avSize + 40, avY + 80);

        // discriminator or tag
        const tag = `#${target.discriminator || (target.username ? target.username : '')}`;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '28px Sans';
        ctx.fillText(tag, avX + avSize + 40, avY + 120);

        // custom message
        if (text) {
            ctx.fillStyle = '#fff';
            ctx.font = '28px Sans';
            const wrapWidth = width - (avX + avSize + 80);
            const words = text.split(' ');
            let line = '';
            let y = avY + 180;
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = ctx.measureText(testLine);
                if (metrics.width > wrapWidth && n > 0) {
                    ctx.fillText(line, avX + avSize + 40, y);
                    line = words[n] + ' ';
                    y += 36;
                } else {
                    line = testLine;
                }
            }
            if (line) ctx.fillText(line, avX + avSize + 40, y);
        }

        // small footer
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '20px Sans';
        ctx.fillText('Beast Bot • Shoutout', width - 260, height - 40);

        const buffer = canvas.toBuffer();
        await interaction.editReply({ files: [{ attachment: buffer, name: 'shoutout.png' }] });
    } catch (e) {
        console.error('/shoutout error', e);
        try { await interaction.editReply({ content: 'Fehler beim Erstellen der Shoutout-Grafik.' }); } catch (_) { }
    }
});

// Removed monkey-patch of Interaction.reply/editReply — avoid modifying library prototypes

// Bot starten
client.once('ready', async () => {
    console.log(`Bot ist online! Eingeloggt als ${client.user.tag}`);

    // Nach Login: Commands für alle derzeit gecachten Gilden registrieren
    try {
        console.log('Registriere Slash-Commands für alle Gilden...');
        // Versuche alle Gilden zu fetchen (falls nicht im Cache)
        const fetched = await client.guilds.fetch();
        for (const [gid] of fetched) {
            try {
                await registerCommandsForGuild(gid);
                // kurze Pause um Rate-Limits zu schonen
                await new Promise(r => setTimeout(r, 750));
            } catch (e) {
                console.error('Fehler beim Registrieren für Gilde', gid, e);
            }
        }
    } catch (e) {
        console.error('Fehler beim initialen Registrieren der Commands:', e);
    }
    try {
        startScheduler();
    } catch (e) {
        console.error('Failed to start scheduler:', e);
    }
});

// Early interaction guard: owner-only mode and disabled commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try {
        const cmd = interaction.commandName;
        const cmdKey = (cmd || '').toLowerCase();
        const cfg = await loadConfig();
        // collect owners
        const owners = new Set();
        if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
        if (cfg.ownerId) owners.add(cfg.ownerId);
        if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
        if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        // ownerOnly global flag
            if (cfg._global && cfg._global.ownerOnly && !isOwner) {
                return interaction.reply({ content: 'Der Bot ist aktuell auf Owner-only Modus gesetzt. Nur Owner dürfen Befehle verwenden.', flags: MessageFlags.Ephemeral });
            }

        // disabled commands (global or guild)
        const guildCfg = cfg[interaction.guild?.id] || {};
        const disabledGlobal = cfg._global && Array.isArray(cfg._global.disabledCommands) && cfg._global.disabledCommands.map(d=>d.toLowerCase()).includes(cmdKey);
        const disabledGuild = Array.isArray(guildCfg.disabledCommands) && guildCfg.disabledCommands.map(d=>d.toLowerCase()).includes(cmdKey);
        if ((disabledGlobal || disabledGuild) && !isOwner) {
            // Friendly message with scope info and owner contact (if available)
            const ownerId = process.env.OWNER_ID || cfg.ownerId || (cfg._global && cfg._global.owners && cfg._global.owners[0]);
            let scopeText = disabledGlobal ? 'global' : 'für diesen Server';
            const ownerText = ownerId ? ('Kontaktiere <@' + ownerId + '> für weitere Informationen.') : 'Kontaktiere den Bot-Owner für weitere Informationen.';
            const message = '⚠️ Der Befehl `/' + cmd + '` ist momentan deaktiviert (' + scopeText + ').\n' + ownerText;
            try {
                // allow this one reply through while preventing others
                interaction.__isGuardReply = true;
                await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
                delete interaction.__isGuardReply;
                interaction.__blocked = true;
            } catch (e) {
                console.error('early guard reply failed', e);
            }
            return;
        }
    } catch (e) {
        console.error('early guard error', e);
    }
});

// Slash-Commands registrieren
const commands = [
    {
        name: 'hallo',
        description: 'Sag Hallo zum Bot!'
    },
    {
        name: 'set-welcome',
        description: 'Setzt den Welcome-Channel für den Server',
        options: [
            { name: 'channel', description: 'Channel für Willkommensnachrichten', type: 7, required: true }
        ]
    },
    {
        name: 'setup',
        description: 'Erstellt eine schöne Server-Struktur mit Emojis',
        options: [
            {
                name: 'typ',
                description: 'Art des Setups',
                type: 3,
                required: true,
                choices: [
                    { name: '🎮 Gaming Server', value: 'gaming' },
                    { name: '💬 Community Server', value: 'community' },
                    { name: '🎵 Musik Server', value: 'musik' },
                    { name: '📺 Streamer Server', value: 'streamer' }
                ]
            },
            {
                name: 'roles',
                description: 'Rollen erstellen? (true=erstellt Rollen, false=nur Struktur)',
                type: 5,
                required: false
            }
        ]
    },
    {
        name: 'shoutout',
        description: 'Erstellt automatisch eine Shoutout-Grafik für einen User/Streamer',
        options: [
            { name: 'user', description: 'Der User/Streamer', type: 6, required: true },
            { name: 'message', description: 'Kurze Nachricht (optional)', type: 3, required: false }
        ]
    },
    {
        name: 'test-welcome',
        description: 'Sendet eine Test-Willkommensnachricht an den konfigurierten Channel'
    },
    {
        name: 'set-autorole',
        description: 'Setzt eine Rolle, die neuen Mitgliedern automatisch gegeben wird',
        options: [
            { name: 'role', description: 'Rolle, die neuen Mitgliedern gegeben wird', type: 8, required: true }
        ]
    },
    {
        name: 'ping',
        description: 'Ping-Pong Test'
    },
    {
        name: 'witz',
        description: 'Holt einen zufälligen Witz'
    },
    {
        name: 'würfeln',
        description: 'Würfle eine Zahl zwischen 1 und 6'
    },
    {
        name: 'server',
        description: 'Zeigt Informationen über den Server'
    },
    {
        name: 'avatar',
        description: 'Zeigt den Avatar eines Users',
        options: [
            {
                name: 'user',
                description: 'Der User dessen Avatar angezeigt werden soll',
                type: 6,
                required: false
            }
        ]
    },
    
    {
        name: 'setup-delete',
        description: 'Entfernt das zuvor mit /setup erstellte Server-Layout (Admin only)'
    },
    {
        name: 'profil',
        description: 'Erstellt ein cooles Profilbild',
        options: [
            {
                name: 'stil',
                description: 'Stil des Profilbildes',
                type: 3,
                required: true,
                choices: [
                    { name: '🎮 Gamer', value: 'gamer' },
                    { name: '🎨 Künstler', value: 'artist' },
                    { name: '🤖 Cyber', value: 'cyber' }
                ]
            },
            {
                name: 'name',
                description: 'Dein Name im Profilbild',
                type: 3,
                required: true
            }
        ]
    },
    {
        name: 'krampus',
        description: 'Ruft den Krampus: schickt ein Krampus-Bild und eine Drohung'
    },
    {
        name: 'setzekrampusmodus',
        description: 'Schalte Krampus-Modus an/aus oder Ultra-Mode',
        options: [
            { name: 'value', description: 'an/aus/ultra-on/ultra-off', type: 3, required: true, choices: [
                { name: 'an', value: 'an' },
                { name: 'aus', value: 'aus' },
                { name: 'ultra-an', value: 'ultra-on' },
                { name: 'ultra-aus', value: 'ultra-off' }
            ]}
        ]
    },
    {
        name: 'tts',
        description: 'Text-to-speech Befehle (z.B. krampus)',
        options: [
            { name: 'who', description: 'Wen soll der Bot sprechen lassen?', type: 3, required: true, choices: [ { name: 'krampus', value: 'krampus' } ] },
            { name: 'text', description: 'Text den Krampus sprechen soll (optional)', type: 3, required: false }
        ]
    },
    {
        name: 'locationkrampus',
        description: 'Sendet einen Fake-Standort des Krampus (z. B. „300m entfernt…")'
    },
    {
        name: 'herbeirufen',
        description: 'Ruft den Krampus herbei (kann Scare-Messages auslösen)'
    },
    {
        name: 'emoji',
        description: 'Fügt einen benutzerdefinierten Emoji zum Server hinzu',
        options: [
            {
                name: 'name',
                description: 'Name des Emojis',
                type: 3,
                required: true
            },
            {
                name: 'url',
                description: 'URL zum Emoji-Bild',
                type: 3,
                required: true
            }
        ]
    }
    ,
    {
        name: 'hack',
        description: 'Simulierter Hack-Screen gegen einen User (Admin)',
        options: [ { name: 'user', description: 'User to hack', type: 6, required: true } ]
    },
    {
        name: 'bruteforce',
        description: 'Simulierter Bruteforce gegen ein Passwort (nur Simulation)',
        options: [ { name: 'password', description: 'Passwort das "gefunden" werden soll', type: 3, required: true } ]
    },
    {
        name: 'phish',
        description: 'Generiert eine simulierte Phishing-Mail (Training, harmlos)',
        options: [ { name: 'target', description: 'Ziel/Quelle (z.B. Bank, Mitarbeiter)', type: 3, required: true } ]
    },
    {
        name: 'virus',
        description: 'Simulierter Spaß-Virus: harmlose Nachrichten/Emojis (begrenzte Anzahl)',
        options: [ { name: 'type', description: 'Art des Spaß-Virus (z.B. trojan)', type: 3, required: false } ]
    },
    {
        name: 'scan',
        description: 'Scant den Server auf einfache Statistiken/Schwächen',
        options: []
    },
    {
        name: 'decrypt',
        description: 'Versucht einfache Entschlüsselungen (Base64/Hex/ROT13)',
        options: [ { name: 'code', description: 'Zu entschlüsselnder Text', type: 3, required: true } ]
    },
    {
        name: 'set-prefix',
        description: 'Setzt das Nachrichten-Präfix für diesen Server (Admin)',
        options: [ { name: 'prefix', description: 'Neues Präfix (z.B. !)', type: 3, required: true }, { name: 'global', description: 'Als global speichern (nur Bot-Owner)', type: 5, required: false } ]
    },
    {
        name: 'set-entertainment',
        description: 'Aktiviere/Deaktiviere Entertainment-Commands in dieser Gilde (Admin)',
        options: [ { name: 'value', description: 'true oder false', type: 3, required: true }, { name: 'global', description: 'Als global speichern (nur Bot-Owner)', type: 5, required: false } ]
    },
    {
        name: 'exploit',
        description: 'Gibt gefälschte Exploits/Vorschläge für gängige Bugs (nur zu Trainingszwecken)',
        options: [ { name: 'bug', description: 'Bug oder Exploit-Thema (z.B. ping-spam)', type: 3, required: true } ]
    },
    {
        name: 'bitcoin',
        description: 'Simuliert Krypto-Mining / Wallet-Ergebnis (nur Spiel/Unterhaltung)',
        options: [ { name: 'amount', description: 'Menge (ganzzahlig)', type: 4, required: true } ]
    },
    {
        name: 'imagine',
        description: 'Erstellt ein Bild aus einem Prompt (benötigt OpenAI API-Key)',
        options: [ { name: 'prompt', description: 'Beschreibung des Bildes', type: 3, required: true } ]
    },
    {
        name: 'set-openai',
        description: 'Setzt den OpenAI API-Key (Admin)',
        options: [ { name: 'key', description: 'OpenAI API Key', type: 3, required: true } ]
    },
    {
        name: 'set-twitch',
        description: 'Setzt den Twitch API-Key oder Client-Credentials für den Server (Admin)',
        options: [ 
            { name: 'client_id', description: 'Twitch Client ID (optional)', type: 3, required: false },
            { name: 'client_secret', description: 'Twitch Client Secret (optional)', type: 3, required: false },
            { name: 'key', description: 'Twitch API Key oder clientId:clientSecret (optional)', type: 3, required: false },
            { name: 'global', description: 'Als global speichern (nur Bot-Owner)', type: 5, required: false }
        ]
    },
    {
        name: 'set-youtube',
        description: 'Setzt den YouTube API-Key für den Server (Admin)',
        options: [ { name: 'key', description: 'YouTube API Key', type: 3, required: true }, { name: 'global', description: 'Als global speichern (nur Bot-Owner)', type: 5, required: false } ]
    },
    {
        name: 'set-elevenlabs',
        description: 'Setzt ElevenLabs API-Key und optional Voice-ID (Admin)',
        options: [
            { name: 'key', description: 'ElevenLabs API Key', type: 3, required: false },
            { name: 'voice_id', description: 'Voice ID (optional)', type: 3, required: false },
            { name: 'global', description: 'Als global speichern (nur Bot-Owner)', type: 5, required: false }
        ]
    },
    {
        name: 'set-website',
        description: 'Setzt die Website-URL für den Server (Admin)',
        options: [ { name: 'url', description: 'Website URL', type: 3, required: true } ]
    },
    {
        name: 'set-welcome-message',
        description: 'Setzt die Willkommensnachricht für neue Mitglieder (Admin)',
        options: [ { name: 'message', description: 'Willkommensnachricht (erlaubt Platzhalter: {user}, {server})', type: 3, required: true } ]
    }
    ,
    {
        name: 'instagram',
        description: 'Holt Informationen über einen Instagram-User (falls API-Key konfiguriert)',
        options: [ { name: 'username', description: 'Instagram Username', type: 3, required: true } ]
    },
    {
        name: 'tiktok',
        description: 'Holt Informationen über einen TikTok-User (falls API-Key konfiguriert)',
        options: [ { name: 'username', description: 'TikTok Username', type: 3, required: true } ]
    },
    {
        name: 'kill',
        description: 'Witzige Death-Animation gegen einen User (Admin)',
        options: [ { name: 'user', description: 'User', type: 6, required: true } ]
    },
    {
        name: 'token-status',
        description: 'Zeigt welche API-Keys / Tokens für diesen Server gespeichert sind'
    },
    {
        name: 'watch',
        description: 'Überwacht einen Streamer auf einem Service (Twitch/YouTube/TikTok/Instagram)',
        options: [
            { name: 'service', description: 'Service', type: 3, required: true, choices: [ { name: 'twitch', value: 'twitch' }, { name: 'youtube', value: 'youtube' }, { name: 'tiktok', value: 'tiktok' }, { name: 'instagram', value: 'instagram' } ] },
            { name: 'username', description: 'Streamer Username', type: 3, required: true },
            { name: 'channel', description: 'Channel zur Benachrichtigung (optional)', type: 7, required: false },
            { name: 'global', description: 'Als globales Watch speichern (für alle Server)', type: 5, required: false }
        ]
    },
    {
        name: '8ball',
        description: 'Frage die magische 8-Ball',
        options: [{ name: 'question', description: 'Deine Frage', type: 3, required: true }]
    },
    {
        name: 'poll',
        description: 'Erstellt eine Ja/Nein-Umfrage',
        options: [{ name: 'question', description: 'Frage für die Umfrage', type: 3, required: true }]
    },
    {
        name: 'say',
        description: 'Lässt den Bot eine Nachricht in diesem Kanal senden (Admin only)',
        options: [ { name: 'message', description: 'Nachricht', type: 3, required: true } ]
    },
    {
        name: 'send',
        description: 'Sendet dem angegebenen User eine DM (Admin-only).',
        options: [
            { name: 'message', description: 'Nachricht', type: 3, required: true },
            { name: 'user', description: 'Ziel-User (optional)', type: 6, required: false },
            { name: 'userid', description: 'Ziel-User ID (optional, z.B. 123456789012345678)', type: 3, required: false },
            { name: 'public', description: 'Wenn DMs blockiert: Nachricht öffentlich in diesem Kanal senden', type: 5, required: false }
        ]
    },
    {
        name: 'userinfo',
        description: 'Zeigt Informationen über einen User',
        options: [{ name: 'user', description: 'User', type: 6, required: false }]
    },
    {
        name: 'roleinfo',
        description: 'Informationen über eine Rolle',
        options: [{ name: 'role', description: 'Rolle', type: 8, required: true }]
    },
    {
        name: 'serverstats',
        description: 'Zeigt Statistiken zum Server'
    },
    {
        name: 'avatarframe',
        description: 'Erstellt ein Avatarbild mit Rahmen',
        options: [
            { name: 'user', description: 'User', type: 6, required: false },
            { name: 'style', description: 'Stil', type: 3, required: false, choices: [ { name: 'gold', value: 'gold' }, { name: 'neon', value: 'neon' } ] }
        ]
    },
    {
        name: 'color',
        description: 'Zeigt eine Farbe und Hex-Code',
        options: [{ name: 'hex', description: 'Hex-Code (#rrggbb)', type: 3, required: false }]
    },
    {
        name: 'meme',
        description: 'Holt ein zufälliges Meme'
    },
    {
        name: 'purge',
        description: 'Löscht Nachrichten (Admin)',
        options: [{ name: 'amount', description: 'Anzahl (max 100)', type: 4, required: true }]
    }
    ,
    {
        name: 'set-support-group',
        description: 'Setzt den Kanal, in dem Support-Anfragen / Bewerbungen ankommen sollen',
        options: [ { name: 'channel', description: 'Support-Kanal', type: 7, required: true } ]
    },
    {
        name: 'set-global-support',
        description: 'Setzt den globale Support-Gruppe (alle Server können hierhin Anfragen schicken)',
        options: [ { name: 'channel', description: 'Support-Kanal (in diesem Server)', type: 7, required: true } ]
    },
    {
        name: 'support',
        description: 'Erstellt eine Support-Anfrage (öffnet ein Ticket)',
        options: [
            { name: 'subject', description: 'Kurzes Thema/Betreff', type: 3, required: true },
            { name: 'message', description: 'Beschreibung deines Problems', type: 3, required: true }
        ]
    },
    {
        name: 'bewerbung',
        description: 'Sendet eine Bewerbung an das Team',
        options: [ { name: 'text', description: 'Deine Bewerbungstext', type: 3, required: true } ]
    },
    {
        name: 'audit-search',
        description: 'Suche kürzliche Nachrichten nach Keyword (Admin)',
        options: [ { name: 'keyword', description: 'Suchbegriff', type: 3, required: true }, { name: 'limit', description: 'Max pro Kanal (default 50)', type: 4, required: false } ]
    },
    {
        name: 'close-ticket',
        description: 'Schließt ein Support-Ticket (Staff)',
        options: [ { name: 'ticket', description: 'Ticketnummer', type: 4, required: true } ]
    },
    {
        name: 'reply',
        description: 'Antwortet auf ein Support-Ticket (Staff)',
        options: [ { name: 'ticket', description: 'Ticketnummer', type: 4, required: true }, { name: 'message', description: 'Antwort', type: 3, required: true } ]
    }
    ,
    {
        name: 'coinflip',
        description: 'Wirft eine Münze (Kopf oder Zahl)'
    },
    {
        name: 'set-announce',
        description: 'Setzt den Ankündigungs-Channel für diesen Server',
        options: [ { name: 'channel', description: 'Ankündigungs-Kanal', type: 7, required: true } ]
    },
    {
        name: 'everyone',
        description: 'Sendet eine Ankündigung an alle Server, in denen ein Announce-Channel gesetzt ist (nur Owner)',
        options: [ { name: 'message', description: 'Die Nachricht für alle', type: 3, required: true } ]
    }
    ,
    {
        name: 'website',
        description: 'Zeigt die Website-URL dieses Servers'
    },
    {
        name: 'ticket',
        description: 'Erstellt ein Support-Ticket',
        options: [ { name: 'subject', description: 'Kurzes Thema/Betreff', type: 3, required: true }, { name: 'message', description: 'Beschreibung deines Problems', type: 3, required: true } ]
    },
    {
        name: 'ticket-status',
        description: 'Zeigt den Status eines Tickets',
        options: [ { name: 'ticket', description: 'Ticketnummer', type: 4, required: true } ]
    },
    {
        name: 'server-announcement',
        description: 'Sendet eine Nachricht an alle Server mit konfiguriertem Announce-Channel (Owner)',
        options: [ { name: 'message', description: 'Die Nachricht für alle', type: 3, required: true } ]
    },
    {
        name: 'schedule',
        description: 'Sende eine Nachricht zu einer bestimmten Zeit an alle Server (Owner)',
        options: [ { name: 'time', description: 'ISO Datetime oder relative (z.B. 10m, 2h)', type: 3, required: true }, { name: 'message', description: 'Nachricht', type: 3, required: true } ]
    },
    {
        name: 'schedule-cancel',
        description: 'Bricht eine geplante Aufgabe ab (Owner)',
        options: [ { name: 'id', description: 'ID der geplanten Aufgabe', type: 4, required: true } ]
    },
    {
        name: 'remind',
        description: 'Erinnert jemanden per Direktnachricht',
        options: [ { name: 'user', description: 'User', type: 6, required: true }, { name: 'time', description: 'ISO Datetime oder relative (z.B. 10m)', type: 3, required: true }, { name: 'message', description: 'Erinnerungs-Nachricht', type: 3, required: true } ]
    },
    {
        name: 'mod',
        description: 'Moderationsbefehle (kick/ban/mute/unmute/purge) (Admin)',
        options: [
            { name: 'action', description: 'Aktion', type: 3, required: true, choices: [ { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }, { name: 'mute', value: 'mute' }, { name: 'unmute', value: 'unmute' }, { name: 'purge', value: 'purge' } ] },
            { name: 'user', description: 'Ziel-User (bei kick/ban/mute/unmute)', type: 6, required: false },
            { name: 'reason', description: 'Begründung (optional)', type: 3, required: false },
            { name: 'duration', description: 'Dauer in Minuten (für mute)', type: 4, required: false },
            { name: 'amount', description: 'Anzahl Nachrichten zum Löschen (purge)', type: 4, required: false },
            { name: 'channel', description: 'Channel für Purge (optional)', type: 7, required: false }
        ]
    }
    ,
    {
        name: 'owner',
        description: 'Owner-Befehle (restart, add, remove, disable, enable, list, only, purge)',
        options: [
            { name: 'sub', description: 'Subcommand', type: 3, required: true, choices: [ { name: 'restart', value: 'restart' }, { name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'disable', value: 'disable' }, { name: 'enable', value: 'enable' }, { name: 'list', value: 'list' }, { name: 'only', value: 'only' }, { name: 'purge', value: 'purge' } ] },
            { name: 'user', description: 'User für add/remove', type: 6, required: false },
            { name: 'cmd', description: 'Command-Name für disable/enable', type: 3, required: false },
            { name: 'scope', description: 'Scope für disable/enable (global oder guild)', type: 3, required: false, choices: [ { name: 'global', value: 'global' }, { name: 'guild', value: 'guild' } ] },
            { name: 'value', description: 'Wert für only (true/false) oder amount für purge', type: 3, required: false },
            { name: 'amount', description: 'Anzahl Nachrichten zum Löschen (purge)', type: 4, required: false },
            { name: 'channel', description: 'Channel für Purge (optional)', type: 7, required: false }
        ]
    }
    ,
    {
        name: 'list-guilds',
        description: 'Zeigt dem Bot-Owner alle Gilden, in denen der Bot ist, inkl. (wenn möglich) Invite-Links'
    },
    {
        name: 'ownertodo',
        description: 'Verwalte deine Owner-Todos (add/list/complete)',
        options: [
            {
                name: 'action',
                description: 'Aktion',
                type: 3,
                required: true,
                choices: [
                    { name: 'add', value: 'add' },
                    { name: 'list', value: 'list' },
                    { name: 'complete', value: 'complete' }
                ]
            },
            { name: 'todo', description: 'Todo-Text (für add)', type: 3, required: false },
            { name: 'id', description: 'Todo-ID zum abhaken (für complete)', type: 4, required: false }
        ]
    },

    {
        name: 'team',
        description: 'Team-Befehle ähnlich wie owner (add/remove/list/only)',
        options: [
            { name: 'sub', description: 'Subcommand', type: 3, required: true, choices: [ { name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }, { name: 'only', value: 'only' } ] },
            { name: 'user', description: 'User für add/remove', type: 6, required: false },
            { name: 'value', description: 'Wert für only (true/false)', type: 3, required: false }
        ]
    },
    {
        name: 'voice',
        description: 'Erstellt einen neuen Voice-Channel für Musik',
        options: [
            { name: 'name', description: 'Name des Voice-Channels', type: 3, required: false }
        ]
    },
    {
        name: 'play',
        description: 'Spielt einen Song in dem Voice-Channel ab (YouTube/URL)',
        options: [
            { name: 'url', description: 'YouTube URL oder Song-Name', type: 3, required: true },
            { name: 'volume', description: 'Lautstärke (0-100)', type: 4, required: false }
        ]
    },
    {
        name: 'ski',
        description: 'Eine lustige Ski-Animation! 🎿'
    },
    {
        name: 'info',
        description: 'Zeigt Informationen über den Bot 🤖'
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Get IDs from environment variables
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const CONFIG_PATH = path.resolve('./guild-config.json');

async function loadConfig() {
    try {
        const txt = await fs.readFile(CONFIG_PATH, 'utf8');
        return JSON.parse(txt || '{}');
    } catch (e) {
        if (e.code === 'ENOENT') return {};
        console.error('Failed to load config:', e);
        return {};
    }
}

async function saveConfig(cfg) {
    try {
        // sanitize disabled command lists before writing
        try {
            const normalize = s => String(s || '').replace(/^\/*/, '').trim().toLowerCase();
            if (cfg._global && Array.isArray(cfg._global.disabledCommands)) {
                cfg._global.disabledCommands = Array.from(new Set(cfg._global.disabledCommands.map(d => normalize(d)).filter(Boolean)));
            }
            for (const k of Object.keys(cfg)) {
                if (k === '_global') continue;
                try {
                    if (cfg[k] && Array.isArray(cfg[k].disabledCommands)) {
                        cfg[k].disabledCommands = Array.from(new Set(cfg[k].disabledCommands.map(d => normalize(d)).filter(Boolean)));
                    }
                } catch (_) {}
            }
        } catch (_) {}
        await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

// small sleep helper used by animated replies
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Simple in-memory cooldown map: key -> timestamp when allowed next
const cooldowns = new Map();
function isOnCooldown(guildId, userId, cmd, seconds) {
    const key = `${guildId || 'dm'}:${userId}:${cmd}`;
    const next = cooldowns.get(key) || 0;
    const now = Date.now();
    if (now < next) return Math.ceil((next - now) / 1000);
    cooldowns.set(key, now + (seconds * 1000));
    return 0;
}

// Helper to send nicer replies with emoji prefix. Accepts string or reply object (embeds/files).
async function niceReply(interaction, payload) {
    try {
        const prefix = interaction.ephemeral ? '🔒 ' : '💬 ';
        if (typeof payload === 'string') {
            return interaction.reply({ content: prefix + payload });
        }
        // payload is an object
        const out = { ...payload };
        if (out.content) out.content = prefix + out.content;
        else out.content = prefix;
        return interaction.reply(out);
    } catch (e) {
        // fallback to original method
        try { return interaction.reply(payload); } catch (_) { console.error('niceReply error', e); }
    }
}

// Helper to edit replies with same emoji style
async function niceEdit(interaction, payload) {
    try {
        const prefix = interaction.ephemeral ? '🔒 ' : '💬 ';
        if (typeof payload === 'string') {
            return interaction.editReply(prefix + payload);
        }
        const out = { ...payload };
        if (out.content) out.content = prefix + out.content;
        else out.content = prefix;
        return interaction.editReply(out);
    } catch (e) {
        try { return interaction.editReply(payload); } catch (_) { console.error('niceEdit error', e); }
    }
}

// Small local DB of programming concepts (German) for quick offline answers
const localConceptDB = {
    'recursion': 'Recursion ist, wenn sich eine Funktion selbst aufruft. Beispiel (Python):\n\n```python\ndef fib(n):\n    if n <= 1:\n        return n\n    return fib(n-1) + fib(n-2)\n```\n\nDas ist nützlich für Probleme, die sich in kleinere, ähnliche Teilprobleme zerlegen lassen.',
    'closure': 'Ein Closure ist eine Funktion, die auf Variablen aus ihrer äußeren Umgebung zugreifen kann, auch nachdem diese Umgebung verlassen wurde. Beispiel (JavaScript):\n\n```javascript\nfunction makeAdder(x) {\n  return function(y) {\n    return x + y;\n  }\n}\nconst add5 = makeAdder(5);\nconsole.log(add5(2)); // 7\n```',
    'async': '"async" beschreibt asynchrone Programmierung: Operationen laufen nebenbei (z.B. Netzwerk), ohne den Haupt-Thread zu blockieren. In JavaScript nutzt man async/await:\n\n```javascript\nasync function fetchData() {\n  const r = await fetch(\'https://example.com\');\n  return await r.json();\n}\n```\n',
    'oop': 'OOP (Objektorientierte Programmierung) organisiert Code in Klassen/Objekte mit Eigenschaften (Attributes) und Verhalten (Methoden). Beispiel (Python):\n\n```python\nclass Dog:\n    def __init__(self, name):\n        self.name = name\n    def bark(self):\n        print(\'Wuff, ich bin\', self.name)\n```\n',
};

// Message-based helper commands (configurable prefix)
client.on('messageCreate', async (message) => {
    try {
        if (!message || message.author?.bot) return;
        const txt = (message.content || '').trim();
        const cfg = await loadConfig();
        const gcfg = (message.guild && cfg[message.guild.id]) ? cfg[message.guild.id] : {};
        const prefix = (gcfg && gcfg.prefix) || (cfg._global && cfg._global.prefix) || '!';
        if (!txt.startsWith(prefix)) return;

        // !explain <concept>
        const m = txt.match(new RegExp('^' + prefix.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&') + 'explain\\s+(.+)$','i'));
        if (m) {
            const conceptRaw = m[1].trim();
            if (!conceptRaw) return message.reply('Bitte gib ein Konzept an. Beispiel: `!explain recursion`');
            const key = conceptRaw.toLowerCase();

            // quick local DB lookup
            if (localConceptDB[key]) {
                return message.reply(localConceptDB[key]);
            }

            // fallback: try OpenAI if API key configured (global or per-guild)
            try {
                const cfg = await loadConfig();
                const gcfg = (message.guild && cfg[message.guild.id]) ? cfg[message.guild.id] : {};
                const openaiKey = process.env.OPENAI_API_KEY || gcfg.openaiKey || (cfg._global && cfg._global.openaiKey);
                if (!openaiKey) {
                    return message.reply(`Kein lokaler Eintrag gefunden für "${conceptRaw}" und kein OpenAI-Key konfiguriert. Versuche einen einfacheren Begriff oder setze einen OpenAI-Key.`);
                }

                // Ask OpenAI for a short German explanation with a small code example
                const prompt = `Erkläre kurz und einfach auf Deutsch das Programmierkonzept "${conceptRaw}" für Anfänger und gib ein kleines Beispiel in einer verbreiteten Sprache (Python/JS). Halte es kurz (maximal ~6 Zeilen Code).`;
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
                    body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'system', content: 'Du erklärst Programmierbegriffe knapp auf Deutsch, mit einem kurzen Beispielcode.' }, { role: 'user', content: prompt }], max_tokens: 400 })
                });
                const j = await res.json();
                if (res.ok && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) {
                    const reply = j.choices[0].message.content.trim();
                    return message.reply(reply);
                } else {
                    console.warn('OpenAI explain failed', j);
                    return message.reply(`Konnte keine Erklärung von OpenAI erhalten. (${j.error?.message || 'unknown'})`);
                }
            } catch (e) {
                console.error('explain fallback error', e);
                return message.reply('Fehler beim Abrufen der Erklärung. Versuch es später nochmal.');
            }
        }
    } catch (e) {
        console.error('messageCreate !explain handler error', e);
    }
});

// Simple, safe handlers for `!run` and `!debug` and message shortcuts
client.on('messageCreate', async (message) => {
    try {
        if (!message || message.author?.bot) return;
        const txt = (message.content || '').trim();
        const cfg = await loadConfig();
        const gcfg = (message.guild && cfg[message.guild.id]) ? cfg[message.guild.id] : {};
        const prefix = (gcfg && gcfg.prefix) || (cfg._global && cfg._global.prefix) || '!';
        if (!txt.startsWith(prefix)) return;

        // parse command after prefix
        const after = txt.slice(prefix.length).trim();
        const parts = after.split(/\s+/);
        const cmd = (parts.shift() || '').toLowerCase();
        const rest = parts.join(' ');

        // !run <expr>  -- VERY limited: only numeric expressions allowed (digits, + - * / ( ) . % and whitespace)
        const runMatch = cmd === 'run' ? [null, rest] : null;
        if (runMatch) {
            const code = runMatch[1].trim();
            if (!code) return message.reply('Bitte gib einen Ausdruck an, z.B. `!run 2 + 2`');

            // Reject anything with letters or underscores to avoid arbitrary code execution
            if (/[a-zA-Z_]/.test(code)) {
                return message.reply('Aus Sicherheitsgründen sind nur einfache numerische Ausdrücke erlaubt (z.B. `!run 2+2*3`). Verwende nur Zahlen und +-*/().');
            }

            // Allow digits, operators, parentheses, decimal points, whitespace and percent
            const safeRe = /^[0-9+\-*/().%\s]+$/;
            if (!safeRe.test(code)) return message.reply('Ungültige Zeichen im Ausdruck. Erlaubt: Zahlen, + - * / ( ) . %');

            // Replace caret ^ with ** for exponent if user used it
            const expr = code.replace(/\^/g, '**');
            try {
                // Evaluate in a strict, minimal Function scope. Input is already validated.
                const result = Function('"use strict"; return (' + expr + ');')();
                return message.reply(`Ergebnis: ${result}`);
            } catch (e) {
                console.error('!run eval error', e);
                return message.reply('Fehler bei der Auswertung: ' + (e.message || String(e)));
            }
        }

        // !debug <error message>
        const debugMatch = cmd === 'debug' ? [null, rest] : null;
        if (debugMatch) {
            const err = debugMatch[1].trim();
            if (!err) return message.reply('Bitte füge die Fehlermeldung an: `!debug NameError: name x is not defined`');

            // Simple keyword-based suggestions
            const suggestions = {
                'NameError': 'Definiere die Variable zuerst. Beispiel: `x = 5` bevor du `print(x)` benutzt.',
                'TypeError': 'Überprüfe die Typen. Vielleicht verwendest du eine Funktion mit falschem Typ (z.B. versuche `str(...)` oder `int(...)`).',
                'IndexError': 'Prüfe, ob der Index innerhalb der Länge der Liste/Sequenz liegt (0 bis len-1).',
                'KeyError': 'Der Dictionary-Schlüssel existiert nicht. Nutze `dict.get(key)` oder prüfe `if key in dict:`.',
                'ZeroDivisionError': 'Division durch 0 ist nicht erlaubt. Stelle sicher, dass der Divisor != 0.',
                'SyntaxError': 'Syntax prüfen: fehlende Klammern, Doppelpunkt oder falsch eingerückter Code.'
            };

            for (const k of Object.keys(suggestions)) {
                if (err.includes(k) || err.toLowerCase().includes(k.toLowerCase())) {
                    return message.reply(`${k} → ${suggestions[k]}`);
                }
            }

            // Fallback: use OpenAI if configured
            try {
                const cfg = await loadConfig();
                const gcfg = (message.guild && cfg[message.guild.id]) ? cfg[message.guild.id] : {};
                const openaiKey = process.env.OPENAI_API_KEY || gcfg.openaiKey || (cfg._global && cfg._global.openaiKey);
                if (!openaiKey) {
                    return message.reply('Keine lokale Regel gefunden und kein OpenAI-Key konfiguriert. Konfiguriere einen OpenAI-Key, um detailliertere Vorschläge zu erhalten.');
                }

                const prompt = `Du bist ein hilfreicher Assistent, der kurze Debug-Tipps auf Deutsch gibt. Nutzer-Fehler: ${err}. Gib eine knappe, konkrete Fehlerursache und einen Fix-Vorschlag (1-2 Sätze).`;
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
                    body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 200 })
                });
                const j = await res.json();
                if (res.ok && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) {
                    return message.reply(j.choices[0].message.content.trim());
                } else {
                    console.warn('OpenAI debug failed', j);
                    return message.reply('Konnte keine Debug-Hilfe von OpenAI erhalten.');
                }
            } catch (e) {
                console.error('!debug fallback error', e);
                return message.reply('Fehler beim Abrufen der Debug-Hilfe.');
            }
        }

        // Message shortcuts for entertainment commands (exploit, bitcoin, phish, virus, hack, bruteforce)
        const entCmds = ['exploit','bitcoin','phish','virus','hack','bruteforce','scan','decrypt'];
        if (entCmds.includes(cmd)) {
            // Check per-guild entertainment toggle and cooldown
            const owners = new Set();
            if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
            if (cfg.ownerId) owners.add(cfg.ownerId);
            if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
            if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
            const isOwner = owners.has(message.author.id);
            const entGlobal = (cfg._global && typeof cfg._global.entertainmentEnabled !== 'undefined') ? !!cfg._global.entertainmentEnabled : true;
            const entGuild = (gcfg && typeof gcfg.entertainmentEnabled !== 'undefined') ? !!gcfg.entertainmentEnabled : true;
            if (!entGlobal && !isOwner) return message.reply('Entertainment-Commands sind global deaktiviert.');
            if (!entGuild && !(message.member && message.member.permissions && message.member.permissions.has && message.member.permissions.has(PermissionFlagsBits.ManageGuild)) && !isOwner) return message.reply('Entertainment-Commands sind für diesen Server deaktiviert.');

            const cd = isOnCooldown(message.guild?.id, message.author.id, cmd, 10);
            if (cd > 0) return message.reply(`Cooldown für \`${cmd}\`: noch ${cd}s`);

            // handle each message command locally (simplified versions)
            if (cmd === 'exploit') {
                const bug = rest || 'unknown';
                const map = {
                    'ping-spam': 'Exploit gefunden: /ping everyone (aber blockiert von Bot – gut so!). Level: Noob',
                    'role-escalation': 'Exploit (gefälscht): Verwende fehlende Role-Checks; Mitigation: Verifiziere Berechtigungen serverseitig. Level: Medium'
                };
                const out = map[bug.toLowerCase()] || `Exploit gefunden (simuliert): ${bug} -> Beispiel-Payload: "/${bug} --exploit" (Nur Simulation)`;
                const warn = '\n\n⚠️ Hinweis: Dies ist eine harmlose Simulation/Aufsummierung. Missbrauch ist illegal.';
                return message.reply(out + warn);
            }
            if (cmd === 'bitcoin') {
                const amt = parseInt(rest) || 1;
                if (amt <= 0) return message.reply('Bitte gib eine positive Menge an.');
                const pricePerBTC = 20000 + Math.random() * 40000;
                let btc = (Math.random() * 0.01) * amt;
                const loss = Math.random() < 0.12;
                if (loss) btc = - (Math.random() * 0.005) * amt;
                const eur = Math.round(btc * pricePerBTC * 100) / 100;
                const btcStr = Math.abs(btc).toFixed(6);
                const resultText = btc < 0 ? `❌ Verlust: -${btcStr} BTC (≈ ${eur} €)` : `✅ Gewinn: ${btcStr} BTC (≈ ${eur} €)`;
                const extra = btc < 0 ? 'Ouch — Pech gehabt. Denk an sichere Passwörter!' : "Nice! Glück gehabt. Investiere weise.";
                return message.reply(`⛏️ Simulation: ${resultText}\n${extra}\n(Preisannahme: ~${Math.round(pricePerBTC)} €/BTC)`);
            }
            if (cmd === 'phish') {
                const target = rest || 'Organisation';
                const subject = `🔔 SIMULATION: Sicherheitswarnung von ${target} — Dringende Aktion erforderlich (TRAINING)`;
                const fakeLink = 'http://fake-link[dot]example';
                const body = `📧 Betreff: ${subject}\n\nHallo,\n\nWir haben verdächtige Aktivitäten in Ihrem Konto festgestellt. Bitte bestätigen Sie Ihre Daten sofort unter ${fakeLink} (DIES IST EINE SIMULATION — NICHT KLICKEN).\n\nMit freundlichen Grüßen,\n${target} Sicherheitsteam`;
                const tips = `**Phishing-Prüfpunkte:**\n- Dringender Tonfall / Drohungen\n- Ungewöhnliche Absenderadresse\n- Aufforderung, persönliche Daten über Links einzugeben\n\n**Hinweis:** Dies ist eine harmlose Trainings-Simulation. Niemals auf unbekannte Links klicken.`;
                return message.channel.send({ embeds: [{ title: `Simulierte Phishing-Mail (${target})`, description: 'TRAININGSBEISPIEL — KEINE echte Nachricht.', color: 0xFFA500, fields: [{ name: 'Nachricht (simuliert)', value: '```' + body + '```' }, { name: 'Erkennungs-Tipps', value: tips }] }] });
            }
            if (cmd === 'virus') {
                const type = (rest || 'fun').toLowerCase();
                const msgs = type === 'trojan' ? ['🦠 Trojan aktiviert! Prozesse starten...', '⚠️ Fehlende Datei: payload.dll', '🔁 Selbstreplikation simuliert...'] : ['🧪 Virus-Simulation: Spaßmodus aktiviert!', '💥 Error 404: Brain not found', '🤖 System: Kaffee-Level niedrig'];
                for (let i=0;i<Math.min(msgs.length,4);i++) { await message.channel.send(msgs[i] + ' (SIMULIERT)'); }
                return message.channel.send('🛡️ Hinweis: Dies war eine harmlose Simulation zu Trainings-/Unterhaltungszwecken.');
            }
            if (cmd === 'hack' || cmd === 'bruteforce') {
                // admin only
                if (!message.member || !message.member.permissions || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply('Nur Server-Admins dürfen diesen simulierten Befehl verwenden.');
                // simple simulated reply
                return message.reply('Simulation gestartet (siehe Slash-Command für detailliertere Ausgabe).');
            }
            if (cmd === 'scan') {
                // reuse existing scan: call slash via suggestion
                return message.reply('Bitte nutze `/scan` für vollständigen Server-Scan (Slash-Command).');
            }
            if (cmd === 'decrypt') {
                // simple attempt: echo fallback to slash
                return message.reply('Bitte nutze `/decrypt` (Slash-Command) für bessere Ausgabe.');
            }
        }

    } catch (e) {
        console.error('messageCreate !run/!debug handler error', e);
    }
});
// Helper: get Twitch app token
async function getTwitchAppToken(clientId, clientSecret) {
    try {
        const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`, { method: 'POST' });
        const j = await res.json();
        if (!res.ok) throw new Error(j.message || JSON.stringify(j));
        return j.access_token;
    } catch (e) {
        console.error('getTwitchAppToken error', e);
        return null;
    }
}

// Helper: fetch Twitch user and stream info
async function getTwitchStatus(clientId, clientSecret, username) {
    try {
        if (!clientId || !clientSecret) return { error: 'Missing Twitch credentials' };
        const token = await getTwitchAppToken(clientId, clientSecret);
        if (!token) return { error: 'Failed to obtain Twitch token' };
        const headers = { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` };
        // get user
        const ures = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, { headers });
        const uj = await ures.json();
        if (!ures.ok || !uj.data || uj.data.length === 0) return { error: 'User not found' };
        const user = uj.data[0];
        // get stream
        const sres = await fetch(`https://api.twitch.tv/helix/streams?user_id=${user.id}`, { headers });
        const sj = await sres.json();
        const stream = (sj.data && sj.data.length) ? sj.data[0] : null;
        if (!stream) return { live: false, user }; 
        // build thumbnail
        const thumb = stream.thumbnail_url ? stream.thumbnail_url.replace('{width}', '640').replace('{height}', '360') : null;
        return {
            live: true,
            user,
            title: stream.title,
            gameName: stream.game_name || (stream.game_id ? stream.game_id : null),
            viewerCount: stream.viewer_count,
            thumbnail: thumb,
            url: `https://twitch.tv/${user.login}`
        };
    } catch (e) {
        console.error('getTwitchStatus error', e);
        return { error: e.message };
    }
}

// Helper: fetch YouTube last upload and live status
async function getYouTubeStatus(apiKey, channelOrName) {
    try {
        if (!apiKey) return { error: 'Missing YouTube API key' };
        // Resolve channel ID: try as channelId or search by channel name
        let channelId = channelOrName;
        if (!channelId.startsWith('UC')) {
            // search channels by forUsername or by query
            const sres = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(channelOrName)}&key=${apiKey}&maxResults=1`);
            const sj = await sres.json();
            if (sj.items && sj.items.length) channelId = sj.items[0].snippet.channelId;
        }
        if (!channelId) return { error: 'Channel not found' };
        // Check live
        const liveRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${apiKey}`);
        const liveJ = await liveRes.json();
        const isLive = liveJ.items && liveJ.items.length > 0;
        let liveInfo = null;
        if (isLive) {
            const v = liveJ.items[0];
            liveInfo = { title: v.snippet.title, url: `https://youtube.com/watch?v=${v.id.videoId}` };
        }
        // get last upload (search for latest video)
        const recentRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&order=date&type=video&maxResults=1&key=${apiKey}`);
        const recentJ = await recentRes.json();
        let last = null;
        if (recentJ.items && recentJ.items.length) {
            const vi = recentJ.items[0];
            const vid = vi.id.videoId;
            const vres = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${vid}&key=${apiKey}`);
            const vj = await vres.json();
            if (vj.items && vj.items.length) {
                const item = vj.items[0];
                last = {
                    title: item.snippet.title,
                    duration: item.contentDetails.duration,
                    views: item.statistics.viewCount,
                    link: `https://youtube.com/watch?v=${vid}`
                };
                // detect shorts: duration PT... usually <60s
                const dur = item.contentDetails.duration || '';
                const match = dur.match(/PT(\d+M)?(\d+S)?/);
                last.shorts = false;
                if (match) {
                    const mins = match[1] ? parseInt(match[1].replace('M','')) : 0;
                    const secs = match[2] ? parseInt(match[2].replace('S','')) : 0;
                    if ((mins*60 + secs) <= 60) last.shorts = true;
                }
            }
        }
        return { live: isLive, liveInfo, last };
    } catch (e) {
        console.error('getYouTubeStatus error', e);
        return { error: e.message };
    }
}

// Parse a time string: accepts ISO datetime or relative like '10m' or '2h'
function parseTimeString(input) {
    if (!input) return null;
    const s = String(input).trim();
    // relative minutes/hours e.g. 10m, 2h
    const rel = s.match(/^(\d+)([mMhH])$/);
    if (rel) {
        const n = parseInt(rel[1], 10);
        const unit = rel[2].toLowerCase();
        const ms = unit === 'h' ? n * 3600 * 1000 : n * 60 * 1000;
        return Date.now() + ms;
    }
    // ISO / RFC parse
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.getTime();
    return null;
}

// Simple scheduler: executes scheduled tasks in cfg._global.schedules
function startScheduler() {
    // run immediately then every 30s
    async function runOnce() {
        try {
            const cfg = await loadConfig();
            if (!cfg._global || !Array.isArray(cfg._global.schedules)) return;
            const now = Date.now();
            const due = cfg._global.schedules.filter(s => !s.sent && s.time <= now);
            if (!due.length) return;
            for (const s of due) {
                try {
                    if (s.type === 'announce') {
                        // send to all guilds with announceChannelId
                        let sent = 0;
                        for (const [gid, gcfg] of Object.entries(cfg)) {
                            if (gid === '_global') continue;
                            const announceId = gcfg && gcfg.announceChannelId;
                            if (!announceId) continue;
                            try {
                                const guild = await client.guilds.fetch(gid).catch(() => null);
                                if (!guild) continue;
                                const ch = guild.channels.cache.get(announceId) || await guild.channels.fetch(announceId).catch(() => null);
                                if (!ch || !ch.isTextBased()) continue;
                                await ch.send({ content: s.message });
                                sent++;
                                await new Promise(r => setTimeout(r, 200));
                            } catch (e) { console.error('scheduler announce send error', e); }
                        }
                        console.log(`Scheduled announce id=${s.id} sent to ${sent} servers.`);
                    } else if (s.type === 'dm') {
                        try {
                            const user = await client.users.fetch(s.targetId).catch(() => null);
                            if (user) await user.send({ content: s.message });
                        } catch (e) { console.error('scheduler dm error', e); }
                    }
                } catch (e) { console.error('run schedule item error', e); }
                // mark as sent by removing from list
                cfg._global.schedules = cfg._global.schedules.filter(x => x.id !== s.id);
            }
            await saveConfig(cfg);
        } catch (e) {
            console.error('Scheduler runOnce error', e);
        }
    }
    runOnce();
    setInterval(runOnce, 30 * 1000);
}

// Register commands helper: registers guild-scoped commands for a given guild
async function registerCommandsForGuild(guildId) {
    if (!CLIENT_ID) {
        console.warn('CLIENT_ID nicht gesetzt - überspringe Command-Registrierung');
        return;
    }
    try {
        console.log(`Registriere Slash-Commands für Gilde ${guildId}...`);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
        console.log(`Slash-Commands für Gilde ${guildId} registriert.`);
    } catch (error) {
        console.error('Error registering commands for guild', guildId, error);
    }
}

// ---- Krampus helpers: TTS generation and voice playback ----
async function generateKrampusAudioBuffer(text) {
    // Try ElevenLabs first
    try {
        const key = process.env.ELEVENLABS_API_KEY;
        const voiceId = process.env.ELEVENLABS_VOICE_ID || 'alloy';
        if (key) {
            const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'xi-api-key': key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });
            if (res.ok) {
                const ab = await res.arrayBuffer();
                return Buffer.from(ab);
            } else {
                console.warn('ElevenLabs TTS failed', res.status, await res.text());
            }
        }
    } catch (e) {
        console.error('ElevenLabs TTS error', e);
    }

    // Try OpenAI TTS (if available)
    try {
        const key = process.env.OPENAI_API_KEY;
        if (key) {
            const res = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text })
            });
            if (res.ok) {
                const ab = await res.arrayBuffer();
                return Buffer.from(ab);
            } else {
                console.warn('OpenAI TTS failed', res.status, await res.text());
            }
        }
    } catch (e) {
        console.error('OpenAI TTS error', e);
    }

    return null;
}

async function playAudioBufferInVoiceChannel(interaction, buffer) {
    if (!buffer) return false;
    try {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return false;
        const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = await import('@discordjs/voice');
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: voiceChannel.guild.id, adapterCreator: voiceChannel.guild.voiceAdapterCreator });
        const player = createAudioPlayer();
        const resource = createAudioResource(buffer, { inputType: StreamType.Arbitrary });
        player.play(resource);
        connection.subscribe(player);
        // stop after finished
        player.on('error', e => console.error('audio player error', e));
        player.on(AudioPlayerStatus.Idle, () => {
            try { connection.destroy(); } catch (_) {}
        });
        return true;
    } catch (e) {
        console.error('playAudioBufferInVoiceChannel error', e);
        return false;
    }
}

// Wenn der Bot einer neuen Gilde beitritt, registriere die Commands sofort dort
client.on('guildCreate', async (guild) => {
    try {
        await registerCommandsForGuild(guild.id);
    } catch (e) {
        console.error('Fehler beim Registrieren von Commands bei guildCreate:', e);
    }
});

// Slash-Commands ausführen
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;

    const { commandName } = interaction;

    // Owner/team/mod handling: implemented in a dedicated handler below
    if (['mod','owner','team'].includes(commandName)) {
        // defer to the dedicated handler further down
    }

    if (commandName === 'hallo') {
        await interaction.reply(`Hallo ${interaction.user.username}! 👋`);
    }

    if (commandName === 'ping') {
        await interaction.reply('Pong 🏓');
    }

    if (commandName === 'witz') {
        try {
            const res = await fetch('https://v2.jokeapi.dev/joke/Any?type=single');
            const data = await res.json();
            await interaction.reply(data.joke || 'Kein Witz gefunden 😅');
        } catch (err) {
            await interaction.reply('Fehler beim Abrufen des Witzes 😢');
        }
    }

    if (commandName === 'würfeln') {
        const number = Math.floor(Math.random() * 6) + 1;
        await interaction.reply(`🎲 Du hast eine ${number} gewürfelt!`);
    }

    if (commandName === 'server') {
        const server = interaction.guild;
        await interaction.reply({
            embeds: [{
                title: server.name,
                description: `Server Information`,
                fields: [
                    { name: 'Mitglieder', value: server.memberCount.toString(), inline: true },
                    { name: 'Server erstellt am', value: server.createdAt.toLocaleDateString(), inline: true },
                    { name: 'Server ID', value: server.id, inline: true }
                ],
                thumbnail: { url: server.iconURL() || 'https://discord.com/assets/322c936a8c8be1b803cd94861bdfa868.png' }
            }]
        });
    }

    if (commandName === 'avatar') {
        const user = interaction.options.getUser('user') || interaction.user;
        await interaction.reply({
            embeds: [{
                title: `Avatar von ${user.username}`,
                image: { url: user.displayAvatarURL({ size: 1024, dynamic: true }) }
            }]
        });
    }

    

    if (commandName === 'profil') {
        const stil = interaction.options.getString('stil');
        const name = interaction.options.getString('name');
        await interaction.deferReply();

        try {
            const canvas = Canvas.createCanvas(800, 800);
            const ctx = canvas.getContext('2d');

            // Hintergrund basierend auf Stil
            ctx.fillStyle = {
                'gamer': '#ff4455',
                'artist': '#44aa88',
                'cyber': '#2244ff'
            }[stil];
            ctx.fillRect(0, 0, 800, 800);

            // Stil-spezifische Designs
            if (stil === 'gamer') {
                // Gaming-Muster
                for (let i = 0; i < 10; i++) {
                    ctx.strokeStyle = '#ffffff33';
                    ctx.beginPath();
                    ctx.moveTo(Math.random() * 800, 0);
                    ctx.lineTo(Math.random() * 800, 800);
                    ctx.stroke();
                }
            } else if (stil === 'artist') {
                // Artistischer Stil: Farbklekse
                for (let i = 0; i < 40; i++) {
                    ctx.fillStyle = `rgba(${Math.floor(Math.random()*255)}, ${Math.floor(Math.random()*255)}, ${Math.floor(Math.random()*255)}, 0.15)`;
                    ctx.beginPath();
                    ctx.arc(Math.random() * 800, Math.random() * 800, Math.random() * 120 + 20, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else if (stil === 'cyber') {
                // Cyber-Stil: Raster
                ctx.strokeStyle = '#ffffff22';
                for (let x = 0; x < 800; x += 20) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, 800);
                    ctx.stroke();
                }
                for (let y = 0; y < 800; y += 20) {
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(800, y);
                    ctx.stroke();
                }
            }

                // no animation here (was accidentally inserted)

            // Name hinzufügen
            ctx.font = '60px sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(name, 400, 400);

            const attachment = { 
                attachment: canvas.toBuffer(),
                name: 'profil.png'
            };

            await interaction.editReply({ files: [attachment] });
        } catch (error) {
            console.error(error);
            await interaction.editReply('Es gab einen Fehler beim Erstellen des Profilbildes! ❌');
        }
    }

    // Krampus: send a Krampus-image (OpenAI if available, else Canvas fallback) and a scary line
    if (commandName === 'krampus') {
        await interaction.deferReply();
        const cfg = await loadConfig();
        const gcfg = cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        const key = process.env.OPENAI_API_KEY || (gcfg.openaiKey) || (cfg._global && cfg._global.openaiKey);
            const scaryPhrases = [
            'I kum glei! Halte dich warm... 🔥',
            'Ich seh dich in der Nacht — zitter nicht! 👀',
            'Die Glocken klingen, und du bist dran...',
            'Krampus kommt, verberg dich!',
            'Deine Sünden sind schwer. Ich weiß wo du wohnst...',
            'Hörst du die Ketten? Sie sind für dich.'
        ];
        const pick = scaryPhrases[Math.floor(Math.random() * scaryPhrases.length)];
        try {
            if (key) {
                try {
                    const res = await fetch('https://api.openai.com/v1/images/generations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                        body: JSON.stringify({ model: 'gpt-image-1', prompt: 'Ultra-detailed cinematic horror portrait of Krampus, alpine folklore creature, shaggy fur, twisted horns, glowing eyes, chains, cinematic lighting, film grain, 8k, highly detailed, atmospheric, dark color palette, octane render, dramatic shadows, DOF', size: '1024x1024', n: 1 })
                    });
                    const j = await res.json();
                    if (res.ok && j.data && j.data[0]) {
                        const data = j.data[0];
                        if (data.b64_json) {
                            const buf = Buffer.from(data.b64_json, 'base64');
                            await interaction.editReply({ content: pick, files: [{ attachment: buf, name: 'krampus.png' }] });
                            return;
                        } else if (data.url) {
                            await interaction.editReply({ content: pick + '\n' + data.url });
                            return;
                        }
                    }
                } catch (e) {
                    console.error('openai image generation error', e);
                }
            }
            // Canvas fallback: generate a dark Krampus-ish image with text
            const canvas = Canvas.createCanvas(1024, 1024);
            const ctx = canvas.getContext('2d');
            // background
            const g = ctx.createLinearGradient(0,0,1024,1024);
            g.addColorStop(0, '#020204');
            g.addColorStop(1, '#2b0000');
            ctx.fillStyle = g;
            ctx.fillRect(0,0,1024,1024);
            // random horns
            ctx.fillStyle = '#2b2b2b';
            for (let i=0;i<6;i++) {
                ctx.beginPath();
                const x = 200 + Math.random()*624;
                const y = 80 + Math.random()*160;
                ctx.ellipse(x,y,40,120, Math.random()*0.5, 0, Math.PI*2);
                ctx.fill();
            }
            // Krampus title
            ctx.font = 'bold 100px serif';
            ctx.fillStyle = '#ffdddd';
            ctx.textAlign = 'center';
            ctx.fillText('KRAMPUS', 512, 420);
            // scary eyes
            ctx.fillStyle = '#ffcc00';
            ctx.beginPath(); ctx.ellipse(420,560,28,40,0,0,Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(604,560,28,40,0,0,Math.PI*2); ctx.fill();
            // mouth
            ctx.fillStyle = '#330000';
            ctx.fillRect(420,640,184,28);
            const buf = canvas.toBuffer();
            await interaction.editReply({ content: pick, files: [{ attachment: buf, name: 'krampus.png' }] });
        } catch (e) {
            console.error('krampus error', e);
            try { await interaction.editReply('Fehler beim Erzeugen des Krampus. Versuch es später nochmal.'); } catch(_){}
        }
        return;
    }

    // tts command: support 'krampus' who -> speak text with discord tts
    if (commandName === 'tts') {
        const who = interaction.options.getString('who');
        const text = interaction.options.getString('text') || '';
        if (who === 'krampus') {
            const say = text || 'I kum glei!';
            try {
                // send TTS message into the channel
                await interaction.reply({ content: `🔊 Krampus sagt: ${say}` , flags: MessageFlags.Ephemeral });
                // send a TTS message to channel (not ephemeral) because ephemeral cannot be TTS
                await interaction.channel.send({ content: say, tts: true });
            } catch (e) {
                console.error('tts krampus error', e);
                return interaction.editReply('Fehler beim Abspielen der TTS.');
            }
            return;
        }
    }

    // Setze Krampus-Modus (an/aus/ultra-on/ultra-off)
    if (commandName === 'setzekrampusmodus') {
        const value = interaction.options.getString('value');
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        const gcfg = cfg[interaction.guild.id];
        // only server admins or owner
        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        const isOwner = owners.has(interaction.user.id);
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner) return interaction.reply({ content: 'Nur Server-Admins oder der Bot-Owner dürfen den Krampus-Modus setzen.', flags: MessageFlags.Ephemeral });
        if (value === 'an') { gcfg.krampus = gcfg.krampus || {}; gcfg.krampus.enabled = true; await saveConfig(cfg); return interaction.reply({ content: 'Krampus-Modus aktiviert für diesen Server.', flags: MessageFlags.Ephemeral }); }
        if (value === 'aus') { gcfg.krampus = gcfg.krampus || {}; gcfg.krampus.enabled = false; await saveConfig(cfg); return interaction.reply({ content: 'Krampus-Modus deaktiviert für diesen Server.', flags: MessageFlags.Ephemeral }); }
        if (value === 'ultra-on') { gcfg.krampus = gcfg.krampus || {}; gcfg.krampus.ultra = true; await saveConfig(cfg); return interaction.reply({ content: 'Krampus Ultra-Mode aktiviert ✅', flags: MessageFlags.Ephemeral }); }
        if (value === 'ultra-off') { gcfg.krampus = gcfg.krampus || {}; gcfg.krampus.ultra = false; await saveConfig(cfg); return interaction.reply({ content: 'Krampus Ultra-Mode deaktiviert ❌', flags: MessageFlags.Ephemeral }); }
        return interaction.reply({ content: 'Unbekannter Wert.', flags: MessageFlags.Ephemeral });
    }

    // locationkrampus: fake location
    if (commandName === 'locationkrampus') {
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        const gcfg = cfg[interaction.guild.id];
        gcfg.krampus = gcfg.krampus || {};
        // random distance 50..1000m and direction
        const dist = Math.floor(50 + Math.random() * 950);
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        gcfg.krampus.lastLocation = { dist, dir, ts: Date.now() };
        await saveConfig(cfg);
        return interaction.reply({ content: `📍 Krampus ist ca. ${dist}m entfernt Richtung ${dir}. Sei auf der Hut!`, flags: MessageFlags.Ephemeral });
    }

    // herbeirufen: call Krampus to this channel (small scare sequence); respects Ultra-Mode
    if (commandName === 'herbeirufen') {
        const cfg = await loadConfig();
        const gcfg = cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        const kr = (gcfg.krampus) || {};
        if (!kr.enabled && !(cfg._global && cfg._global.krampus && cfg._global.krampus.enabled)) {
            return interaction.reply({ content: 'Der Krampus-Modus ist für diesen Server nicht aktiviert.', flags: MessageFlags.Ephemeral });
        }
        // initial announce
        await interaction.reply({ content: '🔔 Du hast den Krampus gerufen... Er nähert sich.', flags: MessageFlags.Ephemeral });
        // build a dramatic embed with optional image
        const embed = {
            title: 'Der Krampus naht...',
            description: 'Etwas Kaltes kommt aus den Bergen. Halte dein Herz bereit.',
            color: 0x8B0000,
            timestamp: new Date().toISOString()
        };
        // attempt to attach an ominous image if available from last /krampus
        try { if (gcfg.krampus && gcfg.krampus.lastImageUrl) embed.image = { url: gcfg.krampus.lastImageUrl }; } catch(_){}
        await interaction.channel.send({ embeds: [embed] });

        // short sequence of scare messages into channel
        const msgs = [
            '🔊 *Schritte in der Ferne...*',
            '👁️ Ich sehe dich...',
            '🔥 I kum glei!'
        ];
        // if ultra -> longer and include TTS
        const ultra = !!kr.ultra;
        setTimeout(async () => {
            try {
                // If user is in voice channel and we can generate audio, play demonic voice
                const voiceBuffer = await generateKrampusAudioBuffer('I kum glei! Du kannst dich nicht verstecken...');
                const played = voiceBuffer ? await playAudioBufferInVoiceChannel(interaction, voiceBuffer) : false;
                for (let i = 0; i < (ultra ? 5 : 3); i++) {
                    const idx = Math.min(i, msgs.length-1);
                    const text = (ultra ? '☠️ ' : '') + msgs[idx] + (ultra ? ' — ULTRA!' : '');
                    // if we played audio, pair short text; otherwise send TTS for extra creepiness
                    if (!played && ultra && i % 2 === 0) await interaction.channel.send({ content: text, tts: true }); else await interaction.channel.send({ content: text });
                    await new Promise(r => setTimeout(r, ultra ? 1400 : 900));
                }
            } catch (e) { console.error('herbeirufen sequence error', e); }
        }, 800);
        return;
    }

    if (commandName === 'emoji') {
        const emojiName = interaction.options.getString('name');
        const emojiUrl = interaction.options.getString('url');
        await interaction.deferReply();

        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
                return await interaction.editReply('Du brauchst die Berechtigung "Emojis verwalten" für diesen Befehl! ❌');
            }

            const response = await fetch(emojiUrl);
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            
            const emoji = await interaction.guild.emojis.create({
                attachment: imageBuffer,
                name: emojiName
            });

            await interaction.editReply(`Emoji ${emoji} wurde erfolgreich hinzugefügt! ✅`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('Es gab einen Fehler beim Hinzufügen des Emojis! Stelle sicher, dass die URL gültig ist und zu einem Bild führt. ❌');
        }
    }

    // Set welcome channel
    if (commandName === 'set-welcome') {
        const channel = interaction.options.getChannel('channel');
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return await interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        }

        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].welcomeChannelId = channel.id;
        await saveConfig(cfg);
        return await interaction.reply({ content: `Willkommens-Channel wurde gesetzt: ${channel}` });
    }

    if (commandName === 'test-welcome') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await loadConfig();
        const guildCfg = cfg[interaction.guild.id];
        if (!guildCfg || !guildCfg.welcomeChannelId) return interaction.editReply('Kein Welcome-Channel konfiguriert.');
        const ch = interaction.guild.channels.cache.get(guildCfg.welcomeChannelId);
        if (!ch) return interaction.editReply('Der konfigurierte Channel wurde nicht gefunden.');
        try {
            await ch.send({ embeds: [{ title: 'Willkommens-Test', description: `Dies ist ein Test von ${interaction.user.toString()}` }] });
            return interaction.editReply('Testnachricht gesendet!');
        } catch (e) {
            console.error(e);
            return interaction.editReply('Fehler beim Senden der Testnachricht.');
        }
    }

    // Set autorole
    if (commandName === 'set-autorole') {
        const role = interaction.options.getRole('role');
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return await interaction.reply({ content: 'Du brauchst die Berechtigung "Rollen verwalten".', flags: MessageFlags.Ephemeral });
        }
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].autoroleId = role.id;
        await saveConfig(cfg);
        return await interaction.reply({ content: `Autorole wurde gesetzt: ${role.name}` });
    }
});
// (Note: earlier code continues) -- we'll re-open listener area and add handlers just after the existing interactionCreate body

// Append additional handler code by listening again for interactions (safe to do)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    const { commandName } = interaction;

    if (commandName === '8ball') {
        const q = interaction.options.getString('question');
        const answers = [
            'Ja.', 'Nein.', 'Vielleicht.', 'Definitiv.', 'Frag später nochmal.', 'Ich bin mir nicht sicher.', 'Auf jeden Fall nicht.', 'Absolute Yes.'
        ];
        const pick = answers[Math.floor(Math.random() * answers.length)];
        await interaction.reply({ content: `🎱 Frage: ${q}\nAntwort: **${pick}**` });
    }

    // (handled by the dedicated /hack handler earlier)

    if (commandName === 'poll') {
        const q = interaction.options.getString('question');
        const msg = await interaction.reply({ content: `📊 **Umfrage:** ${q}`, fetchReply: true });
        try {
            await msg.react('✅');
            await msg.react('❌');
        } catch (e) { console.error('React poll error', e); }
    }

    if (commandName === 'say') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', flags: MessageFlags.Ephemeral });
        const text = interaction.options.getString('message');
        await interaction.reply({ content: 'Nachricht gesendet.', flags: MessageFlags.Ephemeral });
        await interaction.channel.send({ content: text });
    }

    if (commandName === 'userinfo') {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild.members.cache.get(user.id);
        await interaction.reply({ embeds: [{
            title: `${user.username}#${user.discriminator}`,
            thumbnail: { url: user.displayAvatarURL({ dynamic: true }) },
            fields: [
                { name: 'Account erstellt', value: user.createdAt.toLocaleString(), inline: true },
                { name: 'Beigetreten', value: (member && member.joinedAt) ? member.joinedAt.toLocaleString() : 'Unbekannt', inline: true },
                { name: 'Rollen', value: member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.name).join(', ') || 'Keine' : 'Keine' }
            ]
        }]});
    }

    if (commandName === 'roleinfo') {
        const role = interaction.options.getRole('role');
        await interaction.reply({ embeds: [{
            title: `Rolle: ${role.name}`,
            fields: [
                { name: 'Farbe', value: role.hexColor, inline: true },
                { name: 'Position', value: String(role.position), inline: true },
                { name: 'Mitglieder', value: String(role.members.size), inline: true }
            ]
        }]});
    }

    if (commandName === 'serverstats') {
        const guild = interaction.guild;
        const online = guild.members.cache.filter(m => m.presence && m.presence.status !== 'offline').size;
        await interaction.reply({ embeds: [{
            title: `Statistiken: ${guild.name}`,
            fields: [
                { name: 'Mitglieder', value: String(guild.memberCount), inline: true },
                { name: 'Online', value: String(online), inline: true },
                { name: 'Kanäle', value: String(guild.channels.cache.size), inline: true },
                { name: 'Rollen', value: String(guild.roles.cache.size), inline: true }
            ],
            thumbnail: { url: guild.iconURL() }
        }]});
    }

    if (commandName === 'avatarframe') {
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;
        const style = interaction.options.getString('style') || 'gold';
        try {
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size: 512 });
            const res = await fetch(avatarUrl);
            const buf = Buffer.from(await res.arrayBuffer());

            const canvas = Canvas.createCanvas(512, 512);
            const ctx = canvas.getContext('2d');
            const img = await Canvas.loadImage(buf);
            ctx.drawImage(img, 0, 0, 512, 512);

            // simple frame
            ctx.lineWidth = 18;
            ctx.strokeStyle = style === 'neon' ? '#00ffff' : '#ffd700';
            ctx.strokeRect(9, 9, 494, 494);

            const attachment = { attachment: canvas.toBuffer(), name: 'avatarframe.png' };
            await interaction.editReply({ files: [attachment] });
        } catch (e) {
            console.error('avatarframe error', e);
            await interaction.editReply('Fehler beim Erstellen des Avatarrahmens.');
        }
    }

    if (commandName === 'color') {
        const hex = interaction.options.getString('hex') || '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        const clean = hex.startsWith('#') ? hex.slice(1) : hex;
        const buf = Buffer.from([parseInt(clean.slice(0,2), 16), parseInt(clean.slice(2,4), 16), parseInt(clean.slice(4,6), 16)]);
        // create small PNG
        const canvas = Canvas.createCanvas(200, 100);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = `#${clean}`;
        ctx.fillRect(0,0,200,100);
        ctx.fillStyle = '#ffffff';
        ctx.font = '20px sans-serif';
        ctx.fillText(`#${clean.toUpperCase()}`, 10, 55);
        const attachment = { attachment: canvas.toBuffer(), name: 'color.png' };
        await interaction.reply({ content: `Farbe: #${clean.toUpperCase()}`, files: [attachment] });
    }

    if (commandName === 'meme') {
        await interaction.deferReply();
        try {
            const r = await fetch('https://meme-api.com/gimme');
            const j = await r.json();
            await interaction.editReply({ content: j.title, files: [j.url] });
        } catch (e) {
            console.error('meme error', e);
            await interaction.editReply('Fehler beim Laden eines Memes.');
        }
    }

    if (commandName === 'purge') {
        const amount = interaction.options.getInteger('amount');
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'Du brauchst Manage Messages.', flags: MessageFlags.Ephemeral });
        if (amount < 1 || amount > 100) return interaction.reply({ content: 'Anzahl zwischen 1 und 100.', flags: MessageFlags.Ephemeral });
        try {
            const deleted = await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: `Gelöscht: ${deleted.size} Nachrichten.`, flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('purge error', e);
            await interaction.reply({ content: 'Fehler beim Löschen (nachrichten älter als 14 Tage?).', flags: MessageFlags.Ephemeral });
        }
    }
});

// Dedicated handler for /mod, /owner, /team
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    const cmd = interaction.commandName;
    if (!['mod','owner','team'].includes(cmd)) return;

    const cfg = await loadConfig();
    const owners = new Set();
    if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
    if (cfg.ownerId) owners.add(cfg.ownerId);
    if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
    if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
    const isOwner = owners.has(interaction.user.id);

    // team is a separate group; collect
    const team = new Set();
    if (cfg._global && Array.isArray(cfg._global.team)) cfg._global.team.forEach(t => team.add(t));

    try {
        if (cmd === 'mod') {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner) return interaction.reply({ content: 'Nur Admins oder Owner dürfen Moderationsbefehle verwenden.', flags: MessageFlags.Ephemeral });
            const action = interaction.options.getString('action');
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason') || 'Kein Grund angegeben';
            if (action === 'kick') {
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
                if (!member) return interaction.reply({ content: 'User nicht gefunden.', flags: MessageFlags.Ephemeral });
                try { await member.kick(reason); return interaction.reply({ content: `${user.tag} wurde gekickt. Grund: ${reason}` }); } catch (e) { console.error('kick error', e); return interaction.reply({ content: 'Fehler beim Kicken.', flags: MessageFlags.Ephemeral }); }
            }
            if (action === 'ban') {
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                try { await interaction.guild.bans.create(user.id, { reason }); return interaction.reply({ content: `${user.tag} wurde gebannt. Grund: ${reason}` }); } catch (e) { console.error('ban error', e); return interaction.reply({ content: 'Fehler beim Bannen.', flags: MessageFlags.Ephemeral }); }
            }
            if (action === 'mute') {
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                const duration = interaction.options.getInteger('duration') || 10;
                const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
                if (!member) return interaction.reply({ content: 'User nicht gefunden.', flags: MessageFlags.Ephemeral });
                try { const muteRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('muted')) || null; if (muteRole) await member.roles.add(muteRole); return interaction.reply({ content: `${user.tag} wurde für ${duration} Minuten gemutet.` }); } catch (e) { console.error('mute error', e); return interaction.reply({ content: 'Fehler beim Muting.', flags: MessageFlags.Ephemeral }); }
            }
            if (action === 'unmute') {
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
                if (!member) return interaction.reply({ content: 'User nicht gefunden.', flags: MessageFlags.Ephemeral });
                try { const muteRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('muted')) || null; if (muteRole) await member.roles.remove(muteRole); return interaction.reply({ content: `${user.tag} wurde entmutet.` }); } catch (e) { console.error('unmute error', e); return interaction.reply({ content: 'Fehler beim Entfernen des Mute.', flags: MessageFlags.Ephemeral }); }
            }
            if (action === 'purge') {
                const amount = interaction.options.getInteger('amount');
                const ch = interaction.options.getChannel('channel') || interaction.channel;
                if (!amount || amount < 1 || amount > 100) return interaction.reply({ content: 'Bitte gib eine Anzahl zwischen 1 und 100 an.', flags: MessageFlags.Ephemeral });
                try { const deleted = await ch.bulkDelete(amount, true); return interaction.reply({ content: `Gelöscht: ${deleted.size} Nachrichten.`, flags: MessageFlags.Ephemeral }); } catch (e) { console.error('purge error', e); return interaction.reply({ content: 'Fehler beim Löschen (Nachrichten älter als 14 Tage?).', flags: MessageFlags.Ephemeral }); }
            }
            return;
        }

        if (cmd === 'owner') {
            // only owner can use these
            if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf diese Befehle verwenden.', flags: MessageFlags.Ephemeral });
            const sub = interaction.options.getString('sub');
                if (sub === 'restart') {
                await interaction.reply({ content: 'Bot wird neu gestartet...', flags: MessageFlags.Ephemeral });
                setTimeout(() => process.exit(0), 1000);
                return;
            }
            if (sub === 'add') {
                const user = interaction.options.getUser('user');
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                cfg.owners = cfg.owners || [];
                if (!cfg.owners.includes(user.id)) cfg.owners.push(user.id);
                await saveConfig(cfg);
                return interaction.reply({ content: `Owner hinzugefügt: ${user.tag}`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'remove') {
                const user = interaction.options.getUser('user');
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                cfg.owners = cfg.owners || [];
                cfg.owners = cfg.owners.filter(x => x !== user.id);
                await saveConfig(cfg);
                return interaction.reply({ content: `Owner entfernt: ${user.tag}`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'list') {
                cfg.owners = cfg.owners || [];
                const lines = [];
                if (process.env.OWNER_ID) lines.push(`Env OWNER_ID: ${process.env.OWNER_ID}`);
                if (cfg.ownerId) lines.push(`Config ownerId: ${cfg.ownerId}`);
                if (cfg.owners && cfg.owners.length) lines.push(`Owners: ${cfg.owners.join(', ')}`);
                return interaction.reply({ content: lines.join('\n') || 'Keine Owner konfiguriert', flags: MessageFlags.Ephemeral });
            }
            if (sub === 'disable') {
                const raw = (interaction.options.getString('cmd') || '');
                const normalize = s => String(s || '').replace(/^\/*/, '').trim().toLowerCase();
                const cmdName = normalize(raw);
                const scope = interaction.options.getString('scope') || 'global';
                if (!cmdName) return interaction.reply({ content: 'Bitte gib einen Command-Namen an.', flags: MessageFlags.Ephemeral });
                if (scope === 'global') {
                    // only owner can set global disables
                    if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Befehle deaktivieren.', flags: MessageFlags.Ephemeral });
                    cfg._global = cfg._global || {};
                    cfg._global.disabledCommands = cfg._global.disabledCommands || [];
                    if (!cfg._global.disabledCommands.map(d=>normalize(d)).includes(cmdName)) cfg._global.disabledCommands.push(cmdName);
                    await saveConfig(cfg);
                    console.log(`Global command disabled: ${cmdName} by ${interaction.user.tag}`);
                    // debug log written to console and persisted
                    try { console.log('DEBUG: saved cfg._global.disabledCommands =', cfg._global.disabledCommands); } catch(_){}
                    return interaction.reply({ content: `✅ Befehl global deaktiviert: ${cmdName}`, flags: MessageFlags.Ephemeral });
                } else {
                    // guild scope: allow server admins or owner
                    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten" oder musst Owner sein.', flags: MessageFlags.Ephemeral });
                    cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
                    cfg[interaction.guild.id].disabledCommands = cfg[interaction.guild.id].disabledCommands || [];
                    if (!cfg[interaction.guild.id].disabledCommands.map(d=>normalize(d)).includes(cmdName)) cfg[interaction.guild.id].disabledCommands.push(cmdName);
                    await saveConfig(cfg);
                    console.log(`Guild command disabled: ${cmdName} in ${interaction.guild.id} by ${interaction.user.tag}`);
                    try { console.log('DEBUG: saved cfg[gid].disabledCommands =', cfg[interaction.guild.id].disabledCommands); } catch(_){}
                    return interaction.reply({ content: `✅ Befehl für diesen Server deaktiviert: ${cmdName}`, flags: MessageFlags.Ephemeral });
                }
            }
            if (sub === 'enable') {
                const raw = (interaction.options.getString('cmd') || '');
                const normalize = s => String(s || '').replace(/^\/*/, '').trim().toLowerCase();
                const cmdName = normalize(raw);
                const scope = interaction.options.getString('scope') || 'global';
                if (!cmdName) return interaction.reply({ content: 'Bitte gib einen Command-Namen an.', flags: MessageFlags.Ephemeral });
                if (scope === 'global') {
                    if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Befehle aktivieren.', flags: MessageFlags.Ephemeral });
                    cfg._global = cfg._global || {};
                    cfg._global.disabledCommands = cfg._global.disabledCommands || [];
                    cfg._global.disabledCommands = cfg._global.disabledCommands.filter(x => String(x || '').replace(/^\/*/, '').trim().toLowerCase() !== cmdName);
                    await saveConfig(cfg);
                    console.log(`Global command enabled: ${cmdName} by ${interaction.user.tag}`);
                    try { console.log('DEBUG: saved cfg._global.disabledCommands after enable =', cfg._global.disabledCommands); } catch(_){}
                    return interaction.reply({ content: `✅ Befehl global aktiviert: ${cmdName}`, flags: MessageFlags.Ephemeral });
                } else {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten" oder musst Owner sein.', flags: MessageFlags.Ephemeral });
                    cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
                    cfg[interaction.guild.id].disabledCommands = cfg[interaction.guild.id].disabledCommands || [];
                    cfg[interaction.guild.id].disabledCommands = cfg[interaction.guild.id].disabledCommands.filter(x => String(x || '').replace(/^\/*/, '').trim().toLowerCase() !== cmdName);
                    await saveConfig(cfg);
                    console.log(`Guild command enabled: ${cmdName} in ${interaction.guild.id} by ${interaction.user.tag}`);
                    try { console.log('DEBUG: saved cfg[gid].disabledCommands after enable =', cfg[interaction.guild.id].disabledCommands); } catch(_){}
                    return interaction.reply({ content: `✅ Befehl für diesen Server aktiviert: ${cmdName}`, flags: MessageFlags.Ephemeral });
                }
            }
            if (sub === 'only') {
                const val = interaction.options.getString('value');
                cfg._global = cfg._global || {};
                cfg._global.ownerOnly = (val && val.toLowerCase() === 'true');
                await saveConfig(cfg);
                return interaction.reply({ content: `Owner-only Modus ist nun: ${cfg._global.ownerOnly}`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'purge') {
                const amount = interaction.options.getInteger('amount');
                const ch = interaction.options.getChannel('channel') || interaction.channel;
                if (!amount || amount < 1 || amount > 100) return interaction.reply({ content: 'Bitte gib eine Anzahl zwischen 1 und 100 an.', flags: MessageFlags.Ephemeral });
                try { const deleted = await ch.bulkDelete(amount, true); return interaction.reply({ content: `Gelöscht: ${deleted.size} Nachrichten.`, flags: MessageFlags.Ephemeral }); } catch (e) { console.error('owner purge error', e); return interaction.reply({ content: 'Fehler beim Löschen.', flags: MessageFlags.Ephemeral }); }
            }
        }

        if (cmd === 'team') {
            // allow owners and existing team members to manage team
            const sub = interaction.options.getString('sub');
            if (!isOwner && !team.has(interaction.user.id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Nur Owner, Team-Mitglieder oder Server-Admins dürfen diese Befehle verwenden.', flags: MessageFlags.Ephemeral });
            if (sub === 'add') {
                const user = interaction.options.getUser('user');
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                cfg._global = cfg._global || {};
                cfg._global.team = cfg._global.team || [];
                if (!cfg._global.team.includes(user.id)) cfg._global.team.push(user.id);
                await saveConfig(cfg);
                return interaction.reply({ content: `Team-Mitglied hinzugefügt: ${user.tag}`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'remove') {
                const user = interaction.options.getUser('user');
                if (!user) return interaction.reply({ content: 'Bitte gib einen User an.', flags: MessageFlags.Ephemeral });
                cfg._global = cfg._global || {};
                cfg._global.team = cfg._global.team || [];
                cfg._global.team = cfg._global.team.filter(x => x !== user.id);
                await saveConfig(cfg);
                return interaction.reply({ content: `Team-Mitglied entfernt: ${user.tag}`, flags: MessageFlags.Ephemeral });
            }
            if (sub === 'list') {
                cfg._global = cfg._global || {};
                const list = cfg._global.team || [];
                return interaction.reply({ content: list.length ? `Team: ${list.join(', ')}` : 'Kein Team konfiguriert', flags: MessageFlags.Ephemeral });
            }
            if (sub === 'only') {
                const val = interaction.options.getString('value');
                cfg._global = cfg._global || {};
                cfg._global.teamOnly = (val && val.toLowerCase() === 'true');
                await saveConfig(cfg);
                return interaction.reply({ content: `Team-only Modus ist nun: ${cfg._global.teamOnly}`, flags: MessageFlags.Ephemeral });
            }
        }
    } catch (e) {
        console.error('owner/team/mod handler error', e);
        try { await interaction.reply({ content: 'Fehler beim Ausführen des Befehls.', flags: MessageFlags.Ephemeral }); } catch (_) {}
    }
});

// Simulated entertainment commands: /hack and /bruteforce (purely fake, no real hacking)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    const cmd = interaction.commandName;

    // Helper sleep
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // Load config + owner/entertainment flags
    const cfg = await loadConfig();
    const gcfg = (interaction.guild && cfg[interaction.guild.id]) ? cfg[interaction.guild.id] : {};
    const owners = new Set();
    if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
    if (cfg.ownerId) owners.add(cfg.ownerId);
    if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
    if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
    const isOwner = owners.has(interaction.user.id);
    const entGlobal = (cfg._global && typeof cfg._global.entertainmentEnabled !== 'undefined') ? !!cfg._global.entertainmentEnabled : true;
    const entGuild = (gcfg && typeof gcfg.entertainmentEnabled !== 'undefined') ? !!gcfg.entertainmentEnabled : true;

    // global set of entertainment commands for quick check
    const entCmds = ['hack','bruteforce','phish','virus','exploit','bitcoin'];
    if (entCmds.includes(cmd)) {
        if (!entGlobal && !isOwner) return interaction.reply({ content: 'Entertainment-Commands sind global deaktiviert.', flags: MessageFlags.Ephemeral });
        if (!entGuild && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner) return interaction.reply({ content: 'Entertainment-Commands sind für diesen Server deaktiviert.', flags: MessageFlags.Ephemeral });
        const cd = isOnCooldown(interaction.guild?.id, interaction.user.id, cmd, 10);
        if (cd > 0) return interaction.reply({ content: `Bitte warte noch ${cd}s bevor du "/${cmd}" erneut benutzt.`, flags: MessageFlags.Ephemeral });
    }

    // Duplicate /hack handler removed here. Use the dedicated animated
    // /hack handler earlier in this file which performs the safe edit
    // flow and avoids reply/defer races.

    // Duplicate /bruteforce handler removed here. Use the dedicated
    // implementation earlier in the file to avoid multiple listeners
    // acknowledging the same interaction.
    
    if (cmd === 'phish') {
        // Admin-only: create a clearly labeled, educational phishing example
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Nur Server-Admins dürfen diesen Trainingsbefehl verwenden.', flags: MessageFlags.Ephemeral });
        }
        const target = interaction.options.getString('target') || 'Organisation';
        const subject = `🔔 SIMULATION: Sicherheitswarnung von ${target} — Dringende Aktion erforderlich (TRAINING)`;
        const fakeLink = 'http://fake-link[dot]example';
        const body = `📧 Betreff: ${subject}\n\nHallo,\n\nWir haben verdächtige Aktivitäten in Ihrem Konto festgestellt. Bitte bestätigen Sie Ihre Daten sofort unter ${fakeLink} (DIES IST EINE SIMULATION — NICHT KLICKEN).\n\nMit freundlichen Grüßen,\n${target} Sicherheitsteam`;

        // Educational tips (red flags)
        const tips = `**Phishing-Prüfpunkte:**\n- Dringender Tonfall / Drohungen\n- Ungewöhnliche Absenderadresse\n- Aufforderung, persönliche Daten über Links einzugeben\n- Rechtschreib-/Grammatikfehler\n\n**Hinweis:** Dies ist eine harmlose Trainings-Simulation. Niemals auf unbekannte Links klicken.`;

        // Post as an embed into the channel but clearly marked
        const embed = {
            title: `Simulierte Phishing-Mail (${target})`,
            description: `Dies ist ein TRAININGSBEISPIEL — KEINE echte Nachricht.`,
            color: 0xFFA500,
            fields: [
                { name: 'Nachricht (simuliert)', value: '```' + body + '```' },
                { name: 'Erkennungs-Tipps', value: tips }
            ]
        };

        await interaction.reply({ content: 'Simulierte Phishing-Mail generiert und gepostet (sichtbar).', flags: MessageFlags.Ephemeral });
        await interaction.channel.send({ embeds: [embed] });
        return;
    }

    if (cmd === 'virus') {
        // Admin-only and limited to avoid spam
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Nur Server-Admins dürfen diesen simulierten Befehl verwenden.', flags: MessageFlags.Ephemeral });
        }
        const type = (interaction.options.getString('type') || 'fun').toLowerCase();
        await interaction.reply({ content: `🦠 Starte harmlose ${type}-Simulation (begrenzte Nachrichten)...`, flags: MessageFlags.Ephemeral });

        const messages = [];
        if (type === 'trojan') {
            messages.push('🦠 Trojan aktiviert! Prozesse starten...');
            messages.push('⚠️ Fehlende Datei: payload.dll');
            messages.push('🔁 Selbstreplikation simuliert...');
        } else if (type === 'worm') {
            messages.push('🐛 Wurm verbreitet sich in Channels...');
            messages.push('📡 Netzwerkverkehr erhöht (simuliert)...');
            messages.push('✅ Simulation abgeschlossen.');
        } else {
            messages.push('🧪 Virus-Simulation: Spaßmodus aktiviert!');
            messages.push('💥 Error 404: Brain not found');
            messages.push('🤖 System: Kaffee-Level niedrig');
        }

        // limit to 4 messages to avoid spam
        for (let i = 0; i < Math.min(messages.length, 4); i++) {
            await interaction.channel.send({ content: `${messages[i]} (SIMULIERT)` });
            await new Promise(r => setTimeout(r, 700 + Math.floor(Math.random() * 400)));
        }
        await interaction.channel.send({ content: '🛡️ Hinweis: Dies war eine harmlose Simulation zu Trainings-/Unterhaltungszwecken. Keine echten Angriffe wurden durchgeführt.' });
        return;
    }

    // /scan - gather simple server stats and show as embed
    if (cmd === 'scan') {
        if (!interaction.guild) return interaction.reply({ content: 'Dieser Befehl kann nur in einem Server verwendet werden.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply();
        try {
            // Try to ensure members cached for accurate counts
            try { await interaction.guild.members.fetch(); } catch(_){}
            const guild = interaction.guild;
            const memberCount = guild.memberCount || guild.members.cache.size;
            const adminCount = guild.members.cache.filter(m => m.permissions.has(PermissionFlagsBits.Administrator)).size;
            const roleCount = guild.roles.cache.size;
            const channelCount = guild.channels.cache.size;

            // simple weakness heuristics
            const weaknesses = [];
            if (roleCount > 50) weaknesses.push('Viele Rollen (über 50)');
            if (adminCount > 5) weaknesses.push('Viele Admins (>5)');
            if (memberCount < 10) weaknesses.push('Wenig Mitglieder (<10)');
            if (channelCount > 200) weaknesses.push('Viele Channels (>200)');
            if (!weaknesses.length) weaknesses.push('Keine offensichtlichen Schwächen gefunden');

            const embed = {
                title: `🔍 Server-Scan: ${guild.name}`,
                color: 0x00AAFF,
                fields: [
                    { name: 'Mitglieder', value: String(memberCount), inline: true },
                    { name: 'Admins', value: String(adminCount), inline: true },
                    { name: 'Rollen', value: String(roleCount), inline: true },
                    { name: 'Channels', value: String(channelCount), inline: true },
                    { name: 'Schwächen / Hinweise', value: weaknesses.join('\n') }
                ],
                timestamp: new Date().toISOString()
            };

            return interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error('scan error', e);
            return interaction.editReply({ content: 'Fehler beim Scannen des Servers.' });
        }
    }

    // /decrypt - try base64, hex, rot13
    if (cmd === 'decrypt') {
        const code = interaction.options.getString('code') || '';
        if (!code) return interaction.reply({ content: 'Bitte gib den zu entschlüsselnden Text an.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply();
        let result = null;
        let method = null;
        try {
            const cleaned = code.trim();
            // try base64 (simple heuristic)
            const base64Re = /^[A-Za-z0-9+/=\s]+$/;
            if (base64Re.test(cleaned) && cleaned.length % 4 === 0) {
                try {
                    const buf = Buffer.from(cleaned.replace(/\s+/g,''), 'base64');
                    const txt = buf.toString('utf8');
                    // if printable, accept
                    if (txt && txt.length > 0) { result = txt; method = 'base64'; }
                } catch (_e) {}
            }
            // try hex
            if (!result) {
                const hexRe = /^[0-9a-fA-F]+$/;
                if (hexRe.test(cleaned) && cleaned.length % 2 === 0) {
                    try {
                        const buf = Buffer.from(cleaned, 'hex');
                        const txt = buf.toString('utf8');
                        if (txt && txt.length > 0) { result = txt; method = 'hex'; }
                    } catch (_e) {}
                }
            }
            // try rot13
            if (!result) {
                const rot13 = (s) => s.replace(/[A-Za-z]/g, (c) => {
                    const base = c <= 'Z' ? 65 : 97;
                    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
                });
                const r = rot13(cleaned);
                if (r && r !== cleaned) { result = r; method = 'rot13'; }
            }
        } catch (e) {
            console.error('decrypt error', e);
        }

        if (!result) {
            return interaction.editReply({ content: 'Keine unterstützte Entschlüsselung gefunden (getestet: base64, hex, ROT13).' });
        }

        const embed = {
            title: '🔓 Entschlüsselt',
            color: 0x22AA22,
            fields: [
                { name: 'Eingabe', value: '```' + code + '```' },
                { name: 'Methode (vermutet)', value: method },
                { name: 'Ergebnis', value: '```' + result + '```' }
            ],
            footer: { text: 'Hinweis: Dies sind einfache Heuristiken; bei Binärdaten kann die Ausgabe fehlerhaft sein.' }
        };
        return interaction.editReply({ embeds: [embed] });
    }

        // /exploit - provide fake exploit suggestions for learning/entertainment
        if (cmd === 'exploit') {
            const bug = (interaction.options.getString('bug') || '').trim().toLowerCase();
            if (!bug) return interaction.reply({ content: 'Bitte gib ein Bug-Thema an, z.B. `ping-spam`.', flags: MessageFlags.Ephemeral });

            const map = {
                'ping-spam': 'Exploit gefunden: /ping everyone (aber blockiert von Bot – gut so!). Level: Noob',
                'role-escalation': 'Exploit (gefälscht): Verwende fehlende Role-Checks; Mitigation: Verifiziere Berechtigungen serverseitig. Level: Medium',
                'mass-embed': 'Exploit (gefälscht): Sende viele Embeds gleichzeitig; Mitigation: Rate-Limits und Validierung. Level: Low',
                'sql-injection': 'Exploit (gefälscht): Unsichere DB-Queries; Mitigation: Prepared Statements / ORM. Level: High'
            };

            const out = map[bug] || `Exploit gefunden (simuliert): ${bug} -> Beispiel-Payload: "/${bug} --exploit" (Nur Simulation)`;
            const warn = '\n\n⚠️ Hinweis: Dies ist eine harmlose Simulation/Aufsummierung. Missbrauch von Schwachstellen ist illegal. Nutze die Information nur zu Bildungszwecken.';
            return interaction.reply({ content: out + warn, flags: MessageFlags.Ephemeral });
        }

        // /bitcoin - simulate mining or wallet result (fun)
        if (cmd === 'bitcoin') {
            const amt = interaction.options.getInteger('amount') || 1;
            if (amt <= 0) return interaction.reply({ content: 'Bitte gib eine positive Menge an.', flags: MessageFlags.Ephemeral });

            // Random BTC result per unit (small amounts). Small chance of loss.
            const pricePerBTC = 20000 + Math.random() * 40000; // random price between 20k and 60k
            let btc = (Math.random() * 0.01) * amt; // up to 0.01 BTC per unit
            const loss = Math.random() < 0.12; // 12% chance of loss
            if (loss) btc = - (Math.random() * 0.005) * amt;
            const eur = Math.round(btc * pricePerBTC * 100) / 100;
            const btcStr = Math.abs(btc).toFixed(6);
            const resultText = btc < 0 ? `❌ Verlust: -${btcStr} BTC (≈ ${eur} €)` : `✅ Gewinn: ${btcStr} BTC (≈ ${eur} €)`;
            const extra = btc < 0 ? 'Ouch — Pech gehabt. Denk an sichere Passwörter!' : "Nice! Glück gehabt. Investiere weise.";
            return interaction.reply({ content: `⛏️ Simulation: ${resultText}\n${extra}\n(Preisannahme: ~${Math.round(pricePerBTC)} €/BTC)`, flags: MessageFlags.Ephemeral });
        }
});

    // Handlers for /set-prefix and /set-entertainment
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.__blocked) return;
        const cmd = interaction.commandName;
        if (cmd !== 'set-prefix' && cmd !== 'set-entertainment') return;

        const cfg = await loadConfig();
        // collect owners
        const owners = new Set();
        if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
        if (cfg.ownerId) owners.add(cfg.ownerId);
        if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
        if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        if (cmd === 'set-prefix') {
            const prefix = interaction.options.getString('prefix');
            const makeGlobal = interaction.options.getBoolean('global') || false;
            if (!prefix) return interaction.reply({ content: 'Bitte gib ein Prefix an.', flags: MessageFlags.Ephemeral });
            if (makeGlobal) {
                if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Einstellungen setzen.', flags: MessageFlags.Ephemeral });
                cfg._global = cfg._global || {};
                cfg._global.prefix = prefix;
                await saveConfig(cfg);
                return interaction.reply({ content: `Globales Prefix gesetzt: ${prefix}`, flags: MessageFlags.Ephemeral });
            }
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
            cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
            cfg[interaction.guild.id].prefix = prefix;
            await saveConfig(cfg);
            return interaction.reply({ content: `Prefix für diesen Server gesetzt: ${prefix}`, flags: MessageFlags.Ephemeral });
        }

        if (cmd === 'set-entertainment') {
            const val = (interaction.options.getString('value') || '').toLowerCase();
            const makeGlobal = interaction.options.getBoolean('global') || false;
            const bool = (val === 'true' || val === '1' || val === 'on');
            if (makeGlobal) {
                if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Einstellungen setzen.', flags: MessageFlags.Ephemeral });
                cfg._global = cfg._global || {};
                cfg._global.entertainmentEnabled = bool;
                await saveConfig(cfg);
                return interaction.reply({ content: `Global entertainmentEnabled gesetzt: ${bool}`, flags: MessageFlags.Ephemeral });
            }
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
            cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
            cfg[interaction.guild.id].entertainmentEnabled = bool;
            await saveConfig(cfg);
            return interaction.reply({ content: `Entertainment-Commands für diesen Server sind nun: ${bool}`, flags: MessageFlags.Ephemeral });
        }
    });

// Additional handlers for support/ticket and audit features
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    const { commandName } = interaction;

    // Set support group (Admin)
    if (commandName === 'set-support-group') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const channel = interaction.options.getChannel('channel');
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].supportChannelId = channel.id;
        await saveConfig(cfg);
        return interaction.reply({ content: `Support-Kanal gesetzt: ${channel}` });
    }

    // Set announce channel for this guild
    if (commandName === 'set-announce') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const channel = interaction.options.getChannel('channel');
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].announceChannelId = channel.id;
        await saveConfig(cfg);
        return interaction.reply({ content: `Ankündigungs-Kanal gesetzt: ${channel}` });
    }

    // Coinflip
    if (commandName === 'coinflip') {
        const res = Math.random() < 0.5 ? 'Kopf' : 'Zahl';
        return interaction.reply({ content: `Münze geworfen: **${res}**` });
    }

    // (handled by the dedicated /hack handler earlier)

    // Set OpenAI API key (Admin)
    if (commandName === 'set-openai') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const key = interaction.options.getString('key');
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].openaiKey = key;
        await saveConfig(cfg);
        return interaction.reply({ content: 'OpenAI API-Key wurde für diesen Server gespeichert (lokal).', flags: MessageFlags.Ephemeral });
    }

    // Imagine: generate image via OpenAI (if configured)
    if (commandName === 'imagine') {
        const prompt = interaction.options.getString('prompt');
        await interaction.deferReply();
        const cfg = await loadConfig();
        const key = process.env.OPENAI_API_KEY || (cfg[interaction.guild.id] && cfg[interaction.guild.id].openaiKey) || (cfg._global && cfg._global.openaiKey);
        if (!key) return interaction.editReply('Kein OpenAI API-Key gefunden. Setze ihn mit /set-openai oder als `OPENAI_API_KEY` in der Umgebung.');
        try {
            const res = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 })
            });
            const j = await res.json();
            if (!res.ok) {
                console.error('openai image error', j);
                return interaction.editReply('Fehler bei der Bildgenerierung: ' + (j.error?.message || res.statusText));
            }
            // handle b64 or url
            const data = j.data && j.data[0];
            if (!data) return interaction.editReply('Kein Bild vom OpenAI-API erhalten.');
            if (data.b64_json) {
                const buf = Buffer.from(data.b64_json, 'base64');
                await interaction.editReply({ files: [{ attachment: buf, name: 'imagine.png' }] });
            } else if (data.url) {
                await interaction.editReply({ content: data.url });
            } else {
                return interaction.editReply('Unbekanntes Antwortformat von OpenAI.');
            }
        } catch (e) {
            console.error('imagine error', e);
            return interaction.editReply('Fehler bei der Bildgenerierung.');
        }
        return;
    }

    // Set Twitch API key (Admin)
    if (commandName === 'set-twitch') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const clientId = interaction.options.getString('client_id');
        const clientSecret = interaction.options.getString('client_secret');
        const key = interaction.options.getString('key');
        const makeGlobal = interaction.options.getBoolean('global') || false;
        const cfg = await loadConfig();
        // collect owners
        const owners = new Set();
        if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
        if (cfg.ownerId) owners.add(cfg.ownerId);
        if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
        if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        // If clientId/clientSecret provided, store them separately (global or guild)
        if (clientId || clientSecret) {
            if (makeGlobal) {
                if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Credentials setzen.', flags: MessageFlags.Ephemeral });
                cfg._global = cfg._global || {};
                if (clientId) cfg._global.twitchClientId = clientId;
                if (clientSecret) cfg._global.twitchClientSecret = clientSecret;
                await saveConfig(cfg);
                return interaction.reply({ content: 'Twitch Client-ID/Secret global gespeichert (für alle Server).', flags: MessageFlags.Ephemeral });
            }
            cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
            if (clientId) cfg[interaction.guild.id].twitchClientId = clientId;
            if (clientSecret) cfg[interaction.guild.id].twitchClientSecret = clientSecret;
            await saveConfig(cfg);
            return interaction.reply({ content: 'Twitch Client-ID/Secret für diesen Server gespeichert.', flags: MessageFlags.Ephemeral });
        }

        // If key provided, accept either clientId:clientSecret or older key format
        if (key) {
            if (makeGlobal) {
                if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Credentials setzen.', flags: MessageFlags.Ephemeral });
                cfg._global = cfg._global || {};
                if (key.includes(':')) {
                    const parts = key.split(':');
                    cfg._global.twitchClientId = parts[0];
                    cfg._global.twitchClientSecret = parts[1] || cfg._global.twitchClientSecret;
                } else {
                    cfg._global.twitchKey = key;
                }
                await saveConfig(cfg);
                return interaction.reply({ content: 'Twitch-Key/Credentials global gespeichert.', flags: MessageFlags.Ephemeral });
            }

            cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
            if (key.includes(':')) {
                const parts = key.split(':');
                cfg[interaction.guild.id].twitchClientId = parts[0];
                cfg[interaction.guild.id].twitchClientSecret = parts[1] || cfg[interaction.guild.id].twitchClientSecret;
            } else {
                cfg[interaction.guild.id].twitchKey = key;
            }
            await saveConfig(cfg);
            return interaction.reply({ content: 'Twitch-Key/Credentials gespeichert.', flags: MessageFlags.Ephemeral });
        }

        return interaction.reply({ content: 'Bitte gib entweder `client_id` + `client_secret` oder `key` (oder clientId:clientSecret) an.', flags: MessageFlags.Ephemeral });
    }

    // Set ElevenLabs API key / voice id (Admin)
    if (commandName === 'set-elevenlabs') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const key = interaction.options.getString('key');
        const voiceId = interaction.options.getString('voice_id');
        const makeGlobal = interaction.options.getBoolean('global') || false;
        const cfg = await loadConfig();
        // collect owners
        const owners = new Set();
        if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
        if (cfg.ownerId) owners.add(cfg.ownerId);
        if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
        if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        if (!key && !voiceId) return interaction.reply({ content: 'Bitte gib mindestens einen `key` oder `voice_id` an.', flags: MessageFlags.Ephemeral });

        if (makeGlobal) {
            if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Credentials setzen.', flags: MessageFlags.Ephemeral });
            cfg._global = cfg._global || {};
            if (key) cfg._global.elevenlabsKey = key;
            if (voiceId) cfg._global.elevenlabsVoiceId = voiceId;
            await saveConfig(cfg);
            return interaction.reply({ content: 'ElevenLabs API-Key / Voice-ID global gespeichert.', flags: MessageFlags.Ephemeral });
        }

        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        if (key) cfg[interaction.guild.id].elevenlabsKey = key;
        if (voiceId) cfg[interaction.guild.id].elevenlabsVoiceId = voiceId;
        await saveConfig(cfg);
        return interaction.reply({ content: 'ElevenLabs API-Key / Voice-ID für diesen Server gespeichert.', flags: MessageFlags.Ephemeral });
    }

    // Set YouTube API key (Admin)
    if (commandName === 'set-youtube') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const key = interaction.options.getString('key');
        const makeGlobal = interaction.options.getBoolean('global') || false;
        const cfg = await loadConfig();

        // collect owners
        const owners = new Set();
        if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
        if (cfg.ownerId) owners.add(cfg.ownerId);
        if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
        if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));
        const isOwner = owners.has(interaction.user.id);

        if (makeGlobal) {
            if (!isOwner) return interaction.reply({ content: 'Nur der Bot-Owner darf globale Credentials setzen.', flags: MessageFlags.Ephemeral });
            cfg._global = cfg._global || {};
            cfg._global.youtubeKey = key;
            await saveConfig(cfg);
            return interaction.reply({ content: 'YouTube API-Key global gespeichert (für alle Server).', flags: MessageFlags.Ephemeral });
        }

        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].youtubeKey = key;
        await saveConfig(cfg);
        return interaction.reply({ content: 'YouTube API-Key gespeichert (nur für diesen Server).', flags: MessageFlags.Ephemeral });
    }

    // Set Website URL (Admin)
    if (commandName === 'set-website') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const url = interaction.options.getString('url');
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].website = url;
        await saveConfig(cfg);
        return interaction.reply({ content: 'Website-URL gespeichert.', flags: MessageFlags.Ephemeral });
    }

    // Set welcome message template (Admin)
    if (commandName === 'set-welcome-message') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const message = interaction.options.getString('message');
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].welcomeMessage = message;
        await saveConfig(cfg);
        return interaction.reply({ content: 'Willkommensnachricht gespeichert. Platzhalter: {user}, {server}', flags: MessageFlags.Ephemeral });
    }

    // Everyone announcement (Owner only)
    if (commandName === 'everyone') {
        const cfg = await loadConfig();
        const owner = process.env.OWNER_ID || cfg.ownerId;
        if (!owner) return interaction.reply({ content: 'OWNER_ID ist nicht konfiguriert. Setze OWNER_ID in deiner .env oder nutze /set-global-support als zukünftiger Bot-Owner, um dich automatisch zu registrieren.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== owner) return interaction.reply({ content: 'Nur der Bot-Owner darf diesen Befehl verwenden.', flags: MessageFlags.Ephemeral });
        const message = interaction.options.getString('message');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let sent = 0;
        let failed = 0;
        for (const [gid, gcfg] of Object.entries(cfg)) {
            if (gid === '_global') continue;
            const announceId = gcfg && gcfg.announceChannelId;
            if (!announceId) continue;
            try {
                const guild = await client.guilds.fetch(gid).catch(() => null);
                if (!guild) { failed++; continue; }
                const ch = guild.channels.cache.get(announceId) || await guild.channels.fetch(announceId).catch(() => null);
                if (!ch || !ch.isTextBased()) { failed++; continue; }
                await ch.send({ content: `📢 Ankündigung vom Bot-Owner:\n${message}` });
                sent++;
                // small delay to avoid rate limits
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.error('everyone send error', e);
                failed++;
            }
        }
        return interaction.editReply({ content: `Ankündigung gesendet: ${sent} erfolgreich, ${failed} fehlgeschlagen.` });
    }

    // Set global support group (Admin in this guild can set global)
    if (commandName === 'set-global-support') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', flags: MessageFlags.Ephemeral });
        const channel = interaction.options.getChannel('channel');
        const cfg = await loadConfig();
        cfg._global = cfg._global || {};
        cfg._global.guildId = interaction.guild.id;
        cfg._global.channelId = channel.id;

        // Wenn keine OWNER_ID in der Umgebung gesetzt ist, können wir hier einen Owner automatisch
        // in der config speichern (nur einmal). Hinweis: env-Variable bleibt sicherer.
        let autoOwnerSet = false;
        if (!process.env.OWNER_ID && !cfg.ownerId) {
            cfg.ownerId = interaction.user.id;
            autoOwnerSet = true;
        }

        await saveConfig(cfg);
        let replyMsg = `Globaler Support-Kanal gesetzt: ${channel} (Server: ${interaction.guild.name})`;
        if (autoOwnerSet) replyMsg += `\nHinweis: Da keine OWNER_ID in der Umgebung gesetzt ist, habe ich dich automatisch als Bot-Owner (${interaction.user.tag}) eingetragen. Du kannst das später sicherer via .env überschreiben.`;
        return interaction.reply({ content: replyMsg });
    }

    // Create support ticket
    if (commandName === 'support') {
        const subject = interaction.options.getString('subject');
        const message = interaction.options.getString('message');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await loadConfig();
        const guildCfg = cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};

        // prefer guild-specific support channel, fall back to global if configured
        let supportChannelId = guildCfg.supportChannelId;
        let postingGuild = interaction.guild; // where the channel lives
        if (!supportChannelId) {
            if (cfg._global && cfg._global.channelId && cfg._global.guildId) {
                supportChannelId = cfg._global.channelId;
                try {
                    postingGuild = await client.guilds.fetch(cfg._global.guildId);
                } catch (e) {
                    console.error('fetch global guild failed', e);
                }
            }
        }

        if (!supportChannelId) return interaction.editReply('Kein Support-Kanal konfiguriert. Bitte nutze /set-support-group oder /set-global-support als Admin.');
        const ch = postingGuild.channels.cache.get(supportChannelId) || await postingGuild.channels.fetch(supportChannelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return interaction.editReply('Der konfigurierte Support-Kanal ist ungültig oder nicht erreichbar.');

        // decide where to increment ticket counter: use global counter if posting to global
        let ticketNumber;
        if (cfg._global && cfg._global.channelId === supportChannelId) {
            cfg._global.ticketCounter = (cfg._global.ticketCounter || 0) + 1;
            ticketNumber = cfg._global.ticketCounter;
        } else {
            guildCfg.ticketCounter = (guildCfg.ticketCounter || 0) + 1;
            ticketNumber = guildCfg.ticketCounter;
        }

        try {
            const threadName = `ticket-${ticketNumber}-${subject.slice(0,20).replace(/[^a-zA-Z0-9-_]/g,'')}`.slice(0,100);
            const thread = await ch.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PublicThread, reason: 'Neues Support-Ticket' });
            await thread.send({ content: `Neues Ticket #${ticketNumber} von ${interaction.user.toString()} (Server: ${interaction.guild.name})\n**Betreff:** ${subject}\n**Nachricht:** ${message}` });

            // store ticket: global or per-guild
            if (cfg._global && cfg._global.channelId === supportChannelId) {
                cfg._global.tickets = cfg._global.tickets || {};
                cfg._global.tickets[ticketNumber] = { threadId: thread.id, creatorId: interaction.user.id, status: 'open', subject, sourceGuildId: interaction.guild.id };
            } else {
                guildCfg.tickets = guildCfg.tickets || {};
                guildCfg.tickets[ticketNumber] = { threadId: thread.id, creatorId: interaction.user.id, status: 'open', subject };
            }
            await saveConfig(cfg);

            await interaction.editReply(`Support-Ticket erstellt: #${ticketNumber}. Team wird benachrichtigt.`);
        } catch (e) {
            console.error('support create error', e);
            await interaction.editReply('Fehler beim Erstellen des Tickets.');
        }
    }

    // Bewerbung: sendet Bewerbung an Support-Kanal als Thread
    if (commandName === 'bewerbung') {
        const text = interaction.options.getString('text');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await loadConfig();
        const guildCfg = cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};

        // prefer guild-specific support channel, fallback to global
        let supportChannelId = guildCfg.supportChannelId;
        let postingGuild = interaction.guild;
        if (!supportChannelId && cfg._global && cfg._global.channelId && cfg._global.guildId) {
            supportChannelId = cfg._global.channelId;
            try { postingGuild = await client.guilds.fetch(cfg._global.guildId); } catch (e) { console.error('fetch global guild failed', e); }
        }
        if (!supportChannelId) return interaction.editReply('Kein Support-Kanal konfiguriert. Bitte nutze /set-support-group oder /set-global-support als Admin.');
        const ch = postingGuild.channels.cache.get(supportChannelId) || await postingGuild.channels.fetch(supportChannelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return interaction.editReply('Der konfigurierte Support-Kanal ist ungültig oder nicht erreichbar.');

        // choose counter
        let ticketNumber;
        if (cfg._global && cfg._global.channelId === supportChannelId) {
            cfg._global.ticketCounter = (cfg._global.ticketCounter || 0) + 1;
            ticketNumber = cfg._global.ticketCounter;
        } else {
            guildCfg.ticketCounter = (guildCfg.ticketCounter || 0) + 1;
            ticketNumber = guildCfg.ticketCounter;
        }
        try {
            const threadName = `bewerbung-${ticketNumber}-${interaction.user.username}`.slice(0,100);
            const thread = await ch.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PublicThread, reason: 'Neue Bewerbung' });
            await thread.send({ content: `Neue Bewerbung #${ticketNumber} von ${interaction.user.toString()} (Server: ${interaction.guild.name})\n\n${text}` });

            if (cfg._global && cfg._global.channelId === supportChannelId) {
                cfg._global.tickets = cfg._global.tickets || {};
                cfg._global.tickets[ticketNumber] = { threadId: thread.id, creatorId: interaction.user.id, status: 'open', subject: 'Bewerbung', sourceGuildId: interaction.guild.id };
            } else {
                guildCfg.tickets = guildCfg.tickets || {};
                guildCfg.tickets[ticketNumber] = { threadId: thread.id, creatorId: interaction.user.id, status: 'open', subject: 'Bewerbung' };
            }
            await saveConfig(cfg);

            await interaction.editReply(`Deine Bewerbung wurde gesendet (#${ticketNumber}). Danke!`);
        } catch (e) {
            console.error('bewerbung error', e);
            await interaction.editReply('Fehler beim Senden der Bewerbung.');
        }
    }

    // Reply to ticket (Staff)
    if (commandName === 'reply') {
        const ticket = interaction.options.getInteger('ticket');
        const text = interaction.options.getString('message');
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'Nur Staff mit Manage Messages darf antworten.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await loadConfig();
        let ticketObj = null;
        let sourceArea = null; // 'guild' or 'global'
        const guildCfg = cfg[interaction.guild.id];
        if (guildCfg && guildCfg.tickets && guildCfg.tickets[ticket]) {
            ticketObj = guildCfg.tickets[ticket];
            sourceArea = 'guild';
        } else if (cfg._global && cfg._global.tickets && cfg._global.tickets[ticket]) {
            ticketObj = cfg._global.tickets[ticket];
            sourceArea = 'global';
        }
        if (!ticketObj) return interaction.editReply('Ticket nicht gefunden.');
        try {
            // determine which guild holds the thread
            let threadGuild = interaction.guild;
            if (sourceArea === 'global' && cfg._global && cfg._global.guildId) {
                threadGuild = await client.guilds.fetch(cfg._global.guildId);
            }
            const thread = await threadGuild.channels.fetch(ticketObj.threadId).catch(() => null);
            if (!thread || !thread.isThread()) return interaction.editReply('Ticket-Thread nicht gefunden.');
            await thread.send({ content: `Antwort von ${interaction.user.toString()}:\n${text}` });
            await interaction.editReply('Antwort gesendet.');
        } catch (e) {
            console.error('reply error', e);
            await interaction.editReply('Fehler beim Senden der Antwort.');
        }
    }

    // Close ticket (Staff)
    if (commandName === 'close-ticket') {
        const ticket = interaction.options.getInteger('ticket');
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'Nur Staff mit Manage Messages darf Tickets schließen.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await loadConfig();
        // find ticket in guild or global
        let ticketObj = null;
        let sourceArea = null;
        const guildCfg = cfg[interaction.guild.id];
        if (guildCfg && guildCfg.tickets && guildCfg.tickets[ticket]) {
            ticketObj = guildCfg.tickets[ticket];
            sourceArea = 'guild';
        } else if (cfg._global && cfg._global.tickets && cfg._global.tickets[ticket]) {
            ticketObj = cfg._global.tickets[ticket];
            sourceArea = 'global';
        }
        if (!ticketObj) return interaction.editReply('Ticket nicht gefunden.');
        try {
            let threadGuild = interaction.guild;
            if (sourceArea === 'global' && cfg._global && cfg._global.guildId) {
                threadGuild = await client.guilds.fetch(cfg._global.guildId);
            }
            const thread = await threadGuild.channels.fetch(ticketObj.threadId).catch(() => null);
            if (thread && thread.isThread()) {
                await thread.setArchived(true, 'Ticket geschlossen');
            }
            ticketObj.status = 'closed';
            await saveConfig(cfg);
            await interaction.editReply(`Ticket #${ticket} wurde geschlossen.`);
        } catch (e) {
            console.error('close ticket error', e);
            await interaction.editReply('Fehler beim Schließen des Tickets.');
        }
    }

    // Website: show configured website for this guild or global
    if (commandName === 'website') {
        const cfg = await loadConfig();
        const gcfg = cfg[interaction.guild.id] || {};
        const site = gcfg.website || (cfg._global && cfg._global.website);
        if (!site) return interaction.reply({ content: 'Keine Website konfiguriert für diesen Server.', flags: MessageFlags.Ephemeral });
        return interaction.reply({ content: `Website: ${site}` });
    }

    // Ticket: create a ticket (alias to support)
    if (commandName === 'ticket') {
        const subject = interaction.options.getString('subject');
        const message = interaction.options.getString('message');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const cfg = await loadConfig();
        const guildCfg = cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};

        // prefer guild-specific support channel, fall back to global if configured
        let supportChannelId = guildCfg.supportChannelId;
        let postingGuild = interaction.guild; // where the channel lives
        if (!supportChannelId) {
            if (cfg._global && cfg._global.channelId && cfg._global.guildId) {
                supportChannelId = cfg._global.channelId;
                try { postingGuild = await client.guilds.fetch(cfg._global.guildId); } catch (e) { console.error('fetch global guild failed', e); }
            }
        }

        if (!supportChannelId) return interaction.editReply('Kein Support-Kanal konfiguriert. Bitte nutze /set-support-group oder /set-global-support als Admin.');
        const ch = postingGuild.channels.cache.get(supportChannelId) || await postingGuild.channels.fetch(supportChannelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return interaction.editReply('Der konfigurierte Support-Kanal ist ungültig oder nicht erreichbar.');

        // decide where to increment ticket counter: use global counter if posting to global
        let ticketNumber;
        if (cfg._global && cfg._global.channelId === supportChannelId) {
            cfg._global.ticketCounter = (cfg._global.ticketCounter || 0) + 1;
            ticketNumber = cfg._global.ticketCounter;
        } else {
            guildCfg.ticketCounter = (guildCfg.ticketCounter || 0) + 1;
            ticketNumber = guildCfg.ticketCounter;
        }

        try {
            const threadName = `ticket-${ticketNumber}-${subject.slice(0,20).replace(/[^a-zA-Z0-9-_]/g,'')}`.slice(0,100);
            const thread = await ch.threads.create({ name: threadName, autoArchiveDuration: 1440, type: ChannelType.PublicThread, reason: 'Neues Support-Ticket' });
            await thread.send({ content: `Neues Ticket #${ticketNumber} von ${interaction.user.toString()} (Server: ${interaction.guild.name})\n**Betreff:** ${subject}\n**Nachricht:** ${message}` });

            if (cfg._global && cfg._global.channelId === supportChannelId) {
                cfg._global.tickets = cfg._global.tickets || {};
                cfg._global.tickets[ticketNumber] = { threadId: thread.id, creatorId: interaction.user.id, status: 'open', subject, sourceGuildId: interaction.guild.id };
            } else {
                guildCfg.tickets = guildCfg.tickets || {};
                guildCfg.tickets[ticketNumber] = { threadId: thread.id, creatorId: interaction.user.id, status: 'open', subject };
            }
            await saveConfig(cfg);

            await interaction.editReply(`Support-Ticket erstellt: #${ticketNumber}. Team wird benachrichtigt.`);
        } catch (e) {
            console.error('ticket create error', e);
            await interaction.editReply('Fehler beim Erstellen des Tickets.');
        }
        return;
    }

    // Ticket status
    if (commandName === 'ticket-status') {
        const ticket = interaction.options.getInteger('ticket');
        const cfg = await loadConfig();
        const guildCfg = cfg[interaction.guild.id] || {};
        let ticketObj = null;
        let source = null;
        if (guildCfg.tickets && guildCfg.tickets[ticket]) { ticketObj = guildCfg.tickets[ticket]; source = 'guild'; }
        else if (cfg._global && cfg._global.tickets && cfg._global.tickets[ticket]) { ticketObj = cfg._global.tickets[ticket]; source = 'global'; }
        if (!ticketObj) return interaction.reply({ content: 'Ticket nicht gefunden.', flags: MessageFlags.Ephemeral });
        return interaction.reply({ content: `Ticket #${ticket} — Status: ${ticketObj.status || 'unknown'} — Thread: ${ticketObj.threadId || 'n/a'}${ticketObj.sourceGuildId ? ` — Ursprung: ${ticketObj.sourceGuildId}` : ''}` , flags: MessageFlags.Ephemeral });
    }

    // server-announcement (alias to everyone)
    if (commandName === 'server-announcement') {
        const cfg = await loadConfig();
        const owner = process.env.OWNER_ID || cfg.ownerId;
        if (!owner) return interaction.reply({ content: 'OWNER_ID ist nicht konfiguriert. Setze OWNER_ID in deiner .env oder nutze /set-global-support als zukünftiger Bot-Owner, um dich automatisch zu registrieren.', flags: MessageFlags.Ephemeral });
        if (interaction.user.id !== owner) return interaction.reply({ content: 'Nur der Bot-Owner darf diesen Befehl verwenden.', flags: MessageFlags.Ephemeral });
        const message = interaction.options.getString('message');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let sent = 0; let failed = 0;
        for (const [gid, gcfg] of Object.entries(cfg)) {
            if (gid === '_global') continue;
            const announceId = gcfg && gcfg.announceChannelId;
            if (!announceId) continue;
            try {
                const guild = await client.guilds.fetch(gid).catch(() => null);
                if (!guild) { failed++; continue; }
                const ch = guild.channels.cache.get(announceId) || await guild.channels.fetch(announceId).catch(() => null);
                if (!ch || !ch.isTextBased()) { failed++; continue; }
                await ch.send({ content: `📢 Ankündigung vom Bot-Owner:\n${message}` });
                sent++; await new Promise(r=>setTimeout(r,200));
            } catch (e) { console.error('server-announcement send error', e); failed++; }
        }
        return interaction.editReply({ content: `Ankündigung gesendet: ${sent} erfolgreich, ${failed} fehlgeschlagen.` });
    }

    // schedule: owner-only scheduled announce
    if (commandName === 'schedule') {
        const timeStr = interaction.options.getString('time');
        const message = interaction.options.getString('message');
        const cfg = await loadConfig();
        // owner check
        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        if (!owners.has(interaction.user.id)) return interaction.reply({ content: 'Nur der Bot-Owner darf geplante Nachrichten an alle Server senden.', flags: MessageFlags.Ephemeral });
        const ts = parseTimeString(timeStr);
        if (!ts) return interaction.reply({ content: 'Ungültige Zeit. Verwende ISO-Datetime (z.B. 2025-12-06T12:00:00) oder relative wie `10m`/`2h`.', flags: MessageFlags.Ephemeral });
        cfg._global = cfg._global || {};
        cfg._global.schedules = cfg._global.schedules || [];
        cfg._global.nextScheduleId = (cfg._global.nextScheduleId || 1);
        const id = cfg._global.nextScheduleId++;
        cfg._global.schedules.push({ id, type: 'announce', time: ts, message, createdBy: interaction.user.id });
        await saveConfig(cfg);
        return interaction.reply({ content: `Geplante Ankündigung erstellt (ID: ${id}) für ${new Date(ts).toISOString()}`, flags: MessageFlags.Ephemeral });
    }

    // schedule-cancel
    if (commandName === 'schedule-cancel') {
        const id = interaction.options.getInteger('id');
        const cfg = await loadConfig();
        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        if (!owners.has(interaction.user.id)) return interaction.reply({ content: 'Nur der Bot-Owner darf geplante Aufgaben abbrechen.', flags: MessageFlags.Ephemeral });
        cfg._global = cfg._global || {};
        cfg._global.schedules = cfg._global.schedules || [];
        const before = cfg._global.schedules.length;
        cfg._global.schedules = cfg._global.schedules.filter(s => s.id !== id);
        const after = cfg._global.schedules.length;
        await saveConfig(cfg);
        if (before === after) return interaction.reply({ content: `Keine Aufgabe mit ID ${id} gefunden.`, flags: MessageFlags.Ephemeral });
        return interaction.reply({ content: `Aufgabe ${id} wurde abgebrochen.`, flags: MessageFlags.Ephemeral });
    }

    // remind: DM a user at time
    if (commandName === 'remind') {
        const user = interaction.options.getUser('user');
        const timeStr = interaction.options.getString('time');
        const message = interaction.options.getString('message');
        const ts = parseTimeString(timeStr);
        if (!ts) return interaction.reply({ content: 'Ungültige Zeit. Verwende ISO-Datetime oder relative `10m`/`2h`.', flags: MessageFlags.Ephemeral });
        // store reminder in global schedules
        const cfg = await loadConfig();
        cfg._global = cfg._global || {};
        cfg._global.schedules = cfg._global.schedules || [];
        cfg._global.nextScheduleId = (cfg._global.nextScheduleId || 1);
        const id = cfg._global.nextScheduleId++;
        cfg._global.schedules.push({ id, type: 'dm', time: ts, message, targetId: user.id, createdBy: interaction.user.id });
        await saveConfig(cfg);
        return interaction.reply({ content: `Erinnerung geplant (ID: ${id}) für ${user.tag} am ${new Date(ts).toISOString()}`, flags: MessageFlags.Ephemeral });
    }

    // Audit search (Admin) - searches recent messages across up to 8 channels
    if (commandName === 'audit-search') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Nur Admins dürfen Audit-Search verwenden.', flags: MessageFlags.Ephemeral });
        const keyword = interaction.options.getString('keyword');
        const perChannel = interaction.options.getInteger('limit') || 50;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const results = [];
        try {
            const channels = interaction.guild.channels.cache.filter(c => c.isTextBased()).first(8);
            for (const ch of channels) {
                try {
                    const msgs = await ch.messages.fetch({ limit: perChannel });
                    for (const m of msgs.values()) {
                        if (m.content && m.content.toLowerCase().includes(keyword.toLowerCase())) {
                            results.push({ channel: ch.name, author: `${m.author.tag}`, content: m.content.slice(0,200), link: `https://discord.com/channels/${interaction.guild.id}/${ch.id}/${m.id}` });
                            if (results.length >= 20) break;
                        }
                    }
                    if (results.length >= 20) break;
                } catch (e) { console.error('audit fetch channel error', e); }
            }
            if (results.length === 0) return interaction.editReply('Keine Treffer gefunden.');
            const lines = results.map(r => `# ${r.channel} — ${r.author}: ${r.content}\n${r.link}`);
            // send as files if too long
            const chunk = lines.join('\n\n');
            if (chunk.length > 1900) {
                await interaction.editReply({ files: [{ attachment: Buffer.from(chunk, 'utf8'), name: 'audit-results.txt' }] });
            } else {
                await interaction.editReply(chunk);
            }
        } catch (e) {
            console.error('audit error', e);
            await interaction.editReply('Fehler bei der Suche.');
        }
    }
});

// Handle member join: autorole + welcome message
// New commands: instagram, tiktok, kill, token-status, watch
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.__blocked) return;
    const { commandName } = interaction;

    // Instagram info (requires configured key)
    if (commandName === 'instagram') {
        const username = interaction.options.getString('username');
        const cfg = await loadConfig();
        const key = process.env.INSTAGRAM_API_KEY || (cfg[interaction.guild.id] && cfg[interaction.guild.id].instagramKey) || (cfg._global && cfg._global.instagramKey);
        if (!key) return interaction.reply({ content: 'Kein Instagram-API-Key konfiguriert. Bitte setze ihn in der config oder als `INSTAGRAM_API_KEY` in der Umgebung.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply();
        // Placeholder: user must add integration; currently we only acknowledge the request
        try {
            // Real implementation would call the provider here
            await interaction.editReply(`API-Key gefunden — versuche Informationen für Instagram-User ${username}`);
        } catch (e) {
            console.error('instagram info error', e);
            await interaction.editReply('Fehler beim Abrufen der Instagram-Infos.');
        }
        return;
    }

    // TikTok info (requires configured key)
    if (commandName === 'tiktok') {
        const username = interaction.options.getString('username');
        const cfg = await loadConfig();
        const key = process.env.TIKTOK_API_KEY || (cfg[interaction.guild.id] && cfg[interaction.guild.id].tiktokKey) || (cfg._global && cfg._global.tiktokKey);
        if (!key) return interaction.reply({ content: 'Kein TikTok-API-Key konfiguriert. Bitte setze ihn in der config.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply();
        try {
            await interaction.editReply(`API-Key gefunden — versuche Informationen für TikTok-User ${username}.`);
        } catch (e) {
            console.error('tiktok info error', e);
            await interaction.editReply('Fehler beim Abrufen der TikTok-Infos.');
        }
        return;
    }

    // Kill: witzige death animation (Admin)
    if (commandName === 'kill') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', flags: MessageFlags.Ephemeral });
        const target = interaction.options.getUser('user');
        const msg = await interaction.reply({ content: `💀 ${target.tag} wird getötet...`, fetchReply: true });
        const frames = ['😵', '💫', '🔥', '☠️', '✖️'];
        try {
            for (const f of frames) {
                await new Promise(r => setTimeout(r, 700));
                await msg.edit(`${f} ${target.toString()}`);
            }
            await new Promise(r => setTimeout(r, 700));
            await msg.edit(`☠️ ${target.toString()} ist tot. Ruhe in Frieden — Das war nur ein Spiel!`);
        } catch (e) { console.error('kill error', e); }
        return;
    }

    // Token status: shows which API keys/tokens are present for this guild
    if (commandName === 'token-status') {
        const cfg = await loadConfig();
        const gcfg = cfg[interaction.guild.id] || {};
        const lines = [];
        lines.push(`OWNER_ID (env): ${process.env.OWNER_ID ? 'set' : 'not set'}`);
        lines.push(`OWNER_ID (config): ${cfg.ownerId ? 'set' : 'not set'}`);
        lines.push(`OPENAI: ${process.env.OPENAI_API_KEY || gcfg.openaiKey || (cfg._global && cfg._global.openaiKey) ? 'set' : 'not set'}`);
        lines.push(`Twitch: ${gcfg.twitchKey ? 'set' : (cfg._global && cfg._global.twitchKey) ? 'set (global)' : 'not set'}`);
        lines.push(`YouTube: ${gcfg.youtubeKey ? 'set' : (cfg._global && cfg._global.youtubeKey) ? 'set (global)' : 'not set'}`);
        lines.push(`Instagram: ${gcfg.instagramKey ? 'set' : (cfg._global && cfg._global.instagramKey) ? 'set (global)' : 'not set'}`);
        lines.push(`TikTok: ${gcfg.tiktokKey ? 'set' : (cfg._global && cfg._global.tiktokKey) ? 'set (global)' : 'not set'}`);
        lines.push(`Website: ${gcfg.website ? gcfg.website : 'not set'}`);
        return interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    }

    // Watch: query live status for Twitch/YouTube/TikTok/Instagram and optionally store subscription (Admin)
    if (commandName === 'watch') {
        const service = interaction.options.getString('service');
        const username = interaction.options.getString('username');
        const ch = interaction.options.getChannel('channel') || interaction.channel;
        const isGlobal = interaction.options.getBoolean('global') || false;
        const cfg = await loadConfig();

        // handle Twitch
        if (service === 'twitch') {
            // determine credentials: env preferred, then guild-specific client fields, then stored key (legacy)
            let clientId = process.env.TWITCH_CLIENT_ID;
            let clientSecret = process.env.TWITCH_CLIENT_SECRET;
            const gcfg = cfg[interaction.guild.id] || {};
            // guild-specific explicit fields
            if ((!clientId || !clientSecret) && (gcfg.twitchClientId || gcfg.twitchClientSecret)) {
                clientId = clientId || gcfg.twitchClientId;
                clientSecret = clientSecret || gcfg.twitchClientSecret;
            }
            // global explicit fields
            if ((!clientId || !clientSecret) && cfg._global && (cfg._global.twitchClientId || cfg._global.twitchClientSecret)) {
                clientId = clientId || cfg._global.twitchClientId;
                clientSecret = clientSecret || cfg._global.twitchClientSecret;
            }
            // legacy key format stored as twitchKey
            if ((!clientId || !clientSecret)) {
                const stored = (gcfg.twitchKey) || (cfg._global && cfg._global.twitchKey);
                if (stored) {
                    const parts = stored.split(':');
                    clientId = clientId || parts[0];
                    clientSecret = clientSecret || parts[1];
                }
            }
            await interaction.deferReply();
            const res = await getTwitchStatus(clientId, clientSecret, username);
            if (res.error) return interaction.editReply(`Fehler: ${res.error}`);
            if (!res.live) return interaction.editReply(`⚪ ${username} ist aktuell offline. Profil: https://twitch.tv/${res.user.login}`);
            // live
            const viewers = res.viewerCount?.toLocaleString?.() || res.viewerCount;
            const game = res.gameName || 'Unbekannt';
            const reply = `🔴 ${res.user.display_name || res.user.login} ist LIVE!\n🎮 Spiel: ${game}\n👁️ ${viewers} Zuschauer\n📝 Titel: "${res.title}"\n📺 Link: ${res.url}`;
            // save watch: if global requested -> store in cfg._global.watches (owner or ManageGuild), else store per-guild with channel
            if (isGlobal) {
                // only allow if owner or server admin
                const owner = process.env.OWNER_ID || (cfg && cfg.ownerId);
                if (interaction.user.id !== owner && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.editReply('Nur der Bot-Owner oder Server-Admin kann globale Watches setzen.');
                }
                cfg._global = cfg._global || {};
                cfg._global.watches = cfg._global.watches || [];
                cfg._global.watches.push({ service, username, createdBy: interaction.user.id, createdAt: Date.now() });
                await saveConfig(cfg);
                return interaction.editReply(reply + `\n\n✅ Globaler Watch gespeichert. (Benachrichtigungen werden an Server mit konfigurierten Announce-Channels gesendet, sobald ein Poller aktiv ist)`);
            } else {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return await interaction.editReply('Du brauchst die Berechtigung "Kanäle verwalten" für diesen Befehl! ❌');
                }
                cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
                cfg[interaction.guild.id].watches = cfg[interaction.guild.id].watches || [];
                cfg[interaction.guild.id].watches.push({ service, username, channelId: ch.id, createdBy: interaction.user.id, createdAt: Date.now() });
                await saveConfig(cfg);
                return interaction.editReply(reply + `\n\n✅ Watch gespeichert → ${ch}`);
            }
            return interaction.editReply(reply);
        }

        // handle YouTube
        if (service === 'youtube') {
            const apiKey = process.env.YOUTUBE_API_KEY || (cfg[interaction.guild.id] && cfg[interaction.guild.id].youtubeKey) || (cfg._global && cfg._global.youtubeKey);
            if (!apiKey) return interaction.reply({ content: 'Kein YouTube-API-Key konfiguriert. Bitte setze ihn mit /set-youtube oder als YOUTUBE_API_KEY in der Umgebung.', flags: MessageFlags.Ephemeral });
            await interaction.deferReply();
            const info = await getYouTubeStatus(apiKey, username);
            if (info.error) return interaction.editReply(`Fehler: ${info.error}`);
            const parts = [];
            if (info.live) {
                parts.push(`🔴 ${username} ist LIVE!\n📝 Titel: ${info.liveInfo.title}\n📺 Link: ${info.liveInfo.url}`);
            } else {
                parts.push(`⚪ ${username} ist momentan nicht live.`);
            }
            if (info.last) {
                parts.push(`\nLetzter Upload:\n• Titel: ${info.last.title}\n• Dauer: ${info.last.duration}\n• Aufrufe: ${info.last.views}\n• Link: ${info.last.link}\n• Shorts: ${info.last.shorts ? 'Ja' : 'Nein'}`);
            }
            // save watch: follow same global behavior as Twitch
            if (isGlobal) {
                const owner = process.env.OWNER_ID || (cfg && cfg.ownerId);
                if (interaction.user.id !== owner && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return interaction.editReply('Nur der Bot-Owner oder Server-Admin kann globale Watches setzen.');
                }
                cfg._global = cfg._global || {};
                cfg._global.watches = cfg._global.watches || [];
                cfg._global.watches.push({ service, username, createdBy: interaction.user.id, createdAt: Date.now() });
                await saveConfig(cfg);
                parts.push(`\n✅ Globaler Watch gespeichert.`);
            } else {
                if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
                    cfg[interaction.guild.id].watches = cfg[interaction.guild.id].watches || [];
                    cfg[interaction.guild.id].watches.push({ service, username, channelId: ch.id, createdBy: interaction.user.id, createdAt: Date.now() });
                    await saveConfig(cfg);
                    parts.push(`\n✅ Watch gespeichert → ${ch}`);
                }
            }
            return interaction.editReply(parts.join('\n'));
        }

        // handle TikTok / Instagram - requires third-party API/provider key
        if (service === 'tiktok' || service === 'instagram') {
            const keyName = service === 'tiktok' ? 'tiktokKey' : 'instagramKey';
            const key = process.env[(service === 'tiktok') ? 'TIKTOK_API_KEY' : 'INSTAGRAM_API_KEY'] || (cfg[interaction.guild.id] && cfg[interaction.guild.id][keyName]) || (cfg._global && cfg._global[keyName]);
            if (!key) return interaction.reply({ content: `Kein API-Key für ${service} konfiguriert. Bitte setze ihn mit /set-${service} oder als Umgebungsvariable.`, flags: MessageFlags.Ephemeral });
            await interaction.deferReply();
            // Placeholder: no universal public API used here. Inform user.
            return interaction.editReply(`API-Key gefunden — versuche Informationen für ${service} Nutzer ${username} (Integration nicht implementiert). Wenn du eine konkrete API angibst (z. B. RapidAPI provider), implementiere ich das gern.`);
        }

        return interaction.reply({ content: 'Unbekannter Service. Unterstützt: twitch, youtube, tiktok, instagram', flags: MessageFlags.Ephemeral });
    }
});

// Handle member join: autorole + welcome message
client.on('guildMemberAdd', async member => {
    try {
        const cfg = await loadConfig();
        const guildCfg = cfg[member.guild.id];
        if (!guildCfg) return;

        if (guildCfg.autoroleId) {
            const role = member.guild.roles.cache.get(guildCfg.autoroleId);
            if (role) {
                try { await member.roles.add(role); } catch (e) { console.error('Autorole error:', e); }
            }
        }

        if (guildCfg.welcomeChannelId) {
            const ch = member.guild.channels.cache.get(guildCfg.welcomeChannelId);
            if (ch && ch.isTextBased()) {
                try {
                    if (guildCfg.welcomeMessage) {
                        const msg = guildCfg.welcomeMessage.replace(/\{user\}/g, member.toString()).replace(/\{server\}/g, member.guild.name);
                        await ch.send({ content: msg });
                    } else {
                        await ch.send({ embeds: [{ title: `Willkommen auf ${member.guild.name}!`, description: `Hallo ${member.toString()}, schön dass du da bist!`, thumbnail: { url: member.displayAvatarURL({ dynamic: true }) } }] });
                    }
                } catch (e) { console.error('Welcome message error:', e); }
            }
        }
    } catch (e) {
        console.error('guildMemberAdd handler error:', e);
    }
});

    // Additional interaction handler: /say that can DM a specified user
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.__blocked) return;
        if (interaction.commandName !== 'say') return;

        // Admin-only
        if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', flags: MessageFlags.Ephemeral });
        }

        // /say: always send message into the channel where command is used
        const text = interaction.options.getString('message') || '';
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            await interaction.channel.send({ content: text });
            return interaction.editReply({ content: 'Nachricht erfolgreich in diesem Kanal gesendet.' });
        } catch (e) {
            console.error('say channel send error', e);
            return interaction.editReply({ content: `Fehler beim Senden in Kanal: ${e.message || 'unknown'}` });
        }
    });

    // New handler: /send -> DM a specified user (Admin only)
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.__blocked) return;
        if (interaction.commandName !== 'send') return;

        if (!interaction.member || !interaction.member.permissions || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', flags: MessageFlags.Ephemeral });
        }

        const userOption = interaction.options.getUser('user');
        const idOption = interaction.options.getString('userid');
        const text2 = interaction.options.getString('message') || '';
        const publicFallback = !!interaction.options.getBoolean('public');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let targetUser = userOption || null;
        if (!targetUser && idOption) {
            // try to fetch by ID (allow sending to users not in the guild)
            try {
                targetUser = await client.users.fetch(idOption);
            } catch (e) {
                console.error('fetch user by id failed', e);
                return interaction.editReply({ content: `Konnte User mit ID ${idOption} nicht finden.` });
            }
        }

        if (!targetUser) return interaction.editReply({ content: 'Bitte gib einen Ziel-User an (entweder über das User-Feld oder eine UserID).' });

        try {
            // Try to explicitly create a DM channel first (better for detailed errors)
            let dmChannel = null;
            try {
                if (typeof targetUser.createDM === 'function') {
                    dmChannel = await targetUser.createDM();
                }
            } catch (e) {
                console.warn('createDM failed (will fallback to user.send):', e && e.message);
            }

            if (dmChannel && typeof dmChannel.send === 'function') {
                await dmChannel.send({ content: text2 });
            } else {
                // fallback: user.send should normally create a DM as well
                await targetUser.send({ content: text2 });
            }

            return interaction.editReply({ content: `Private Nachricht erfolgreich an ${targetUser.tag} gesendet.` });
        } catch (e) {
            console.error('send DM error', e);
            // Discord returns error code 50007 when the bot cannot message the user
            const discordCode = e && e.code;
            if (discordCode === 50007) {
                // Cannot send messages to this user. Offer or perform public fallback if requested.
                if (publicFallback) {
                    try {
                        const mention = `<@${targetUser.id}>`;
                        const publicMsg = `Nachricht an ${mention} (öffentliche Zustellung, da DMs blockiert):\n${text2}`;
                        await interaction.channel.send({ content: publicMsg });
                        return interaction.editReply({ content: `Konnte ${targetUser.tag} nicht per DM erreichen — Nachricht wurde stattdessen öffentlich in diesem Kanal gesendet.` });
                    } catch (e2) {
                        console.error('public fallback send error', e2);
                        return interaction.editReply({ content: `Fehler: Konnte weder per DM noch öffentlich an ${targetUser.tag} senden.` });
                    }
                }
                return interaction.editReply({ content: `Fehler beim Senden an ${targetUser.tag}: Der Bot kann diesem Nutzer keine DMs senden (Code ${discordCode}). Möglicherweise hat der Nutzer DMs deaktiviert oder blockiert den Bot.` });
            }
            const reason = (e && e.message) ? e.message : 'unknown';
            return interaction.editReply({ content: `Fehler beim Senden an ${targetUser.tag}: ${reason}.` });
        }
    });

    // Owner-only: list all guilds the bot is in, attempt to create invite links where allowed
    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.__blocked) return;
        if (interaction.commandName !== 'list-guilds') return;

        const cfg = await loadConfig();
        const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
        if (!owners.has(interaction.user.id)) return interaction.reply({ content: 'Nur der Bot-Owner kann diese Information abrufen.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ ephemeral: true });
        try {
            const fetched = await client.guilds.fetch();
            const lines = [];
            for (const [gid, gdata] of fetched) {
                let g = null;
                try { g = await client.guilds.fetch(gid); } catch(_) { g = gdata; }
                const name = (g && g.name) ? g.name : (`Guild ${gid}`);
                const memberCount = (g && g.memberCount) ? g.memberCount : 'unknown';
                let inviteText = 'kein Invite (no permission)';
                try {
                    const channels = await (g.channels.fetch ? g.channels.fetch().catch(()=>null) : Promise.resolve(g.channels || null));
                    if (channels) {
                        const ch = Array.from(channels.values()).find(c => c && c.type === ChannelType.GuildText && c.permissionsFor && c.permissionsFor(client.user) && c.permissionsFor(client.user).has(PermissionFlagsBits.CreateInstantInvite));
                        if (ch && ch.createInvite) {
                            const inv = await ch.createInvite({ maxAge: 0, unique: true }).catch(()=>null);
                            if (inv && inv.code) inviteText = `https://discord.gg/${inv.code}`;
                        }
                    }
                } catch (e) {}
                lines.push(`${name} (id: ${gid}) — Mitglieder: ${memberCount} — Invite: ${inviteText}`);
            }
            const out = lines.join('\n');
            if (out.length > 1800) {
                const buf = Buffer.from(out, 'utf8');
                await interaction.editReply({ content: 'Die Liste ist zu lang — siehe Anhang.', files: [{ attachment: buf, name: 'guilds.txt' }] });
            } else {
                await interaction.editReply({ content: 'Gildenliste:\n' + out });
            }
        } catch (e) {
            console.error('list-guilds error', e);
            try { await interaction.editReply({ content: 'Fehler beim Abrufen der Gilden: ' + (e.message || String(e)) }); } catch(_){}
        }
    });

    // Owner-Todo List Manager
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.__blocked) return;
            if (interaction.commandName !== 'ownertodo') return;

            const cfg = await loadConfig();
            const owners = new Set();
            if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID);
            if (cfg.ownerId) owners.add(cfg.ownerId);
            if (Array.isArray(cfg.owners)) cfg.owners.forEach(o => owners.add(o));
            if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o => owners.add(o));

            if (!owners.has(interaction.user.id)) {
                return interaction.reply({ 
                    content: '❌ Nur der Bot-Owner kann diesen Befehl ausführen.', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const action = interaction.options.getString('action');
            
            // Initialize todo list if not exists
            cfg._global = cfg._global || {};
            cfg._global.todos = cfg._global.todos || [];
            cfg._global.nextTodoId = cfg._global.nextTodoId || 1;

            if (action === 'add') {
                const todoText = interaction.options.getString('todo');
                if (!todoText) {
                    return interaction.reply({ 
                        content: '❌ Bitte gib einen Todo-Text an.', 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                const todoId = cfg._global.nextTodoId++;
                cfg._global.todos.push({
                    id: todoId,
                    text: todoText,
                    completed: false,
                    createdBy: interaction.user.tag,
                    createdAt: new Date().toISOString(),
                    completedAt: null
                });

                await saveConfig(cfg);

                return interaction.reply({
                    content: `✅ Todo #${todoId} hinzugefügt: **${todoText}**\n\nNutze \`/ownertodo list\` um alle Todos zu sehen!`,
                    flags: MessageFlags.Ephemeral
                });
            }

            else if (action === 'list') {
                if (cfg._global.todos.length === 0) {
                    return interaction.reply({
                        content: '📋 Keine Todos vorhanden! Erstelle eine mit \`/ownertodo add\`',
                        flags: MessageFlags.Ephemeral
                    });
                }

                let listText = '📋 **Owner Todos:**\n\n';
                const pending = cfg._global.todos.filter(t => !t.completed);
                const completed = cfg._global.todos.filter(t => t.completed);

                if (pending.length > 0) {
                    listText += '**⏳ Ausstehend:**\n';
                    pending.forEach(todo => {
                        listText += `  #${todo.id} ▫️ ${todo.text}\n`;
                    });
                }

                if (completed.length > 0) {
                    listText += '\n**✅ Abgehakt:**\n';
                    completed.forEach(todo => {
                        listText += `  #${todo.id} ✔️ ~~${todo.text}~~\n`;
                    });
                }

                listText += `\n**Gesamt:** ${cfg._global.todos.length} | **Offen:** ${pending.length} | **Fertig:** ${completed.length}`;

                return interaction.reply({
                    content: listText,
                    flags: MessageFlags.Ephemeral
                });
            }

            else if (action === 'complete') {
                const todoId = interaction.options.getInteger('id');
                if (!todoId) {
                    return interaction.reply({ 
                        content: '❌ Bitte gib die Todo-ID an.', 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                const todo = cfg._global.todos.find(t => t.id === todoId);
                if (!todo) {
                    return interaction.reply({ 
                        content: `❌ Todo #${todoId} nicht gefunden.`, 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                if (todo.completed) {
                    return interaction.reply({ 
                        content: `⚠️ Todo #${todoId} ist bereits abgehakt.`, 
                        flags: MessageFlags.Ephemeral 
                    });
                }

                todo.completed = true;
                todo.completedAt = new Date().toISOString();
                await saveConfig(cfg);

                return interaction.reply({
                    content: `✅ Todo #${todoId} abgehakt: ~~${todo.text}~~`,
                    flags: MessageFlags.Ephemeral
                });
            }

        } catch (e) {
            console.error('ownertodo handler error', e);
            await interaction.reply({
                content: '❌ Fehler bei der Todo-Verwaltung.',
                flags: MessageFlags.Ephemeral
            });
        }
    });

    // Ensure /hack is handled: edits reply progressively (robust fallback)
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.__blocked) return;
            if (interaction.commandName !== 'hack') return;

            // permission: ManageGuild or owner
            const cfg = await loadConfig();
            const owners = new Set(); if (process.env.OWNER_ID) owners.add(process.env.OWNER_ID); if (cfg.ownerId) owners.add(cfg.ownerId); if (Array.isArray(cfg.owners)) cfg.owners.forEach(o=>owners.add(o)); if (cfg._global && Array.isArray(cfg._global.owners)) cfg._global.owners.forEach(o=>owners.add(o));
            const isOwner = owners.has(interaction.user.id);
            if (!interaction.member || !interaction.member.permissions || (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) && !isOwner)) {
                return interaction.reply({ content: 'Nur Server-Admins dürfen diesen simulierten Befehl verwenden.', flags: MessageFlags.Ephemeral });
            }

            const target = interaction.options.getUser('user');
            if (!target) return interaction.reply({ content: 'Bitte gib ein Ziel-User an.', flags: MessageFlags.Ephemeral });

            // Reply (if not already replied/deferred) and then edit progressively
            if (!interaction.replied && !interaction.deferred) {
                try { await interaction.reply({ content: '🔒 Initialisiere Hack-Simulation...', fetchReply: false }); } catch (_) { }
            } else {
                try { await interaction.editReply({ content: '🔒 Initialisiere Hack-Simulation...' }); } catch (_) { }
            }

            const frames = ['⠁','⠂','⠄','⡀','⢀','⠠','⠐','⠈'];
            const steps = [
                { text: 'Initialisiere Verbindung', pct: 8 },
                { text: 'Handshake & Fingerprint', pct: 18 },
                { text: 'Firewall-Bypass', pct: 34 },
                { text: 'Ports scannen', pct: 46 },
                { text: 'Exploit vorbereiten', pct: 60 },
                { text: 'Payload übertragen', pct: 74 },
                { text: 'Sitzung aufbauen', pct: 88 },
                { text: 'Daten extrahieren', pct: 98 }
            ];

            for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                const blocks = Math.floor((s.pct / 100) * 24);
                const bar = '█'.repeat(blocks) + '░'.repeat(24 - blocks);
                for (let f = 0; f < 3; f++) {
                    const frame = frames[(i + f) % frames.length];
                    const content = `${frame}  【${target.tag}】  ${s.text}\n` + '```' + bar + ' ' + s.pct + '%```' + '\n' + '_Status: running..._';
                    try {
                        if (interaction.deferred || interaction.replied) await interaction.editReply({ content }); else await interaction.reply({ content, fetchReply: false });
                    } catch (e) { /* ignore edit errors */ }
                    await sleep(180 + Math.floor(Math.random() * 220));
                }
            }

            const fakePasswords = ['1234','password','qwerty','letmein','P@ssw0rd','hunter2','iloveyou','dragon','sunshine'];
            const found = fakePasswords[Math.floor(Math.random() * fakePasswords.length)];
            try { await interaction.editReply({ content: `✅ Zugriff erlangt auf ${target.tag} — Ergebnisse:` }); } catch(_){}
            await sleep(650);
            try { await interaction.followUp({ content: '🔑 Gefundenes Passwort: `' + found + '` (Nur Spaß! 🔒)', flags: MessageFlags.Ephemeral }); } catch (e) { try { await interaction.channel.send({ content: '🔑 Gefundenes Passwort: ' + found + ' (Nur Spaß!)' }); } catch(_){} }
        } catch (e) {
            console.error('hack handler error', e);
            try { if (!interaction.replied) await interaction.reply({ content: 'Fehler beim Ausführen des /hack Befehls.', flags: MessageFlags.Ephemeral }); else await interaction.editReply({ content: 'Fehler beim Ausführen des /hack Befehls.' }); } catch(_){ }
        }
    });

    // Voice Channel Handler: /voice erstellt einen neuen Voice-Channel
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.__blocked) return;
            if (interaction.commandName !== 'voice') return;

            const channelName = interaction.options.getString('name') || `🎵 Music-${Date.now().toString().slice(-4)}`;
            
            try {
                const voiceChannel = await interaction.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildVoice,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                        }
                    ]
                });

                // Speichere den Voice-Channel in der Config
                const cfg = await loadConfig();
                cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
                cfg[interaction.guild.id].voiceChannelId = voiceChannel.id;
                await saveConfig(cfg);

                await interaction.reply({
                    content: `✅ Voice-Channel erstellt: ${voiceChannel.toString()}\n\nNutze jetzt \`/play <url>\` um Musik abzuspielen!`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (e) {
                console.error('voice channel creation error', e);
                await interaction.reply({
                    content: '❌ Fehler beim Erstellen des Voice-Channels. Stelle sicher, dass ich die Berechtigung habe, Kanäle zu erstellen.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (e) {
            console.error('voice handler error', e);
        }
    });

    // Play Music Handler: /play spielt Musik im Voice-Channel ab
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.__blocked) return;
            if (interaction.commandName !== 'play') return;

            const query = interaction.options.getString('url');
            const volume = interaction.options.getInteger('volume') || 50;

            if (volume < 0 || volume > 100) {
                return interaction.reply({
                    content: '❌ Lautstärke muss zwischen 0 und 100 liegen.',
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply();

            try {
                // Hole den gespeicherten Voice-Channel
                const cfg = await loadConfig();
                const gcfg = cfg[interaction.guild.id] || {};
                const voiceChannelId = gcfg.voiceChannelId;

                if (!voiceChannelId) {
                    return interaction.editReply('❌ Kein Voice-Channel konfiguriert. Nutze zuerst `/voice` um einen zu erstellen.');
                }

                const voiceChannel = await interaction.guild.channels.fetch(voiceChannelId).catch(() => null);
                if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
                    return interaction.editReply('❌ Der konfigurierte Voice-Channel existiert nicht mehr. Erstelle einen neuen mit `/voice`.');
                }

                await interaction.editReply('🔄 Suche und lade Musik...');

                try {
                    const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } = await import('@discordjs/voice');
                    const playdl = await import('play-dl');

                    let stream = null;
                    let videoTitle = 'Audio';
                    let videoDuration = 0;

                    const isUrl = query.startsWith('http://') || query.startsWith('https://');

                    if (isUrl) {
                        // Direct URL - validate and stream
                        try {
                            console.log(`📍 Validating URL: ${query}`);
                            const isValid = await playdl.default.validate(query);
                            
                            if (!isValid) {
                                return interaction.editReply(`❌ URL ist ungültig oder nicht unterstützt.`);
                            }

                            try {
                                console.log(`🎵 Streaming URL: ${query}`);
                                const streamResult = await playdl.default.stream(query);
                                stream = streamResult.stream;
                                videoTitle = streamResult.info?.videoDetails?.title || streamResult.info?.title || query;
                                videoDuration = streamResult.info?.videoDetails?.lengthSeconds || 0;
                            } catch (e) {
                                console.warn('URL stream error:', e.message);
                                // Fallback: try a ytsearch by extracting possible keywords from URL
                                const fallbackQuery = query;
                                try {
                                    console.log(`🔁 Falling back to ytsearch for: ${fallbackQuery}`);
                                    const fallback = await playdl.default.stream(`ytsearch:${fallbackQuery}`);
                                    stream = fallback.stream;
                                    videoTitle = fallback.info?.videoDetails?.title || fallback.info?.title || videoTitle;
                                    videoDuration = fallback.info?.videoDetails?.lengthSeconds || videoDuration;
                                } catch (err) {
                                    console.error('URL fallback error:', err.message);
                                    return interaction.editReply(`❌ Fehler beim Stream:\n\`\`\`${e.message}\`\`\``);
                                }
                            }

                        } catch (e) {
                            console.error('URL validation error:', e.message);
                            return interaction.editReply(`❌ Fehler beim Stream:\n\`\`\`${e.message}\`\`\``);
                        }
                    } else {
                        // Search for song
                        try {
                            console.log(`🔍 Searching for: ${query}`);
                            const results = await playdl.default.search(query, { limit: 1 });
                            
                            if (!results || results.length === 0) {
                                return interaction.editReply(`❌ Kein Lied gefunden für: **${query}**`);
                            }

                            const result = results[0];
                            console.log(`✅ Found: ${result.title} (${result.url})`);
                            
                            // Get stream, with fallback to ytsearch if result.url fails
                            try {
                                const streamResult = await playdl.default.stream(result.url);
                                stream = streamResult.stream;
                                videoTitle = result.title || 'Audio';
                                videoDuration = result.durationMs ? Math.floor(result.durationMs / 1000) : 0;
                            } catch (e) {
                                console.warn('Stream from result.url failed, trying ytsearch fallback:', e.message);
                                try {
                                    const fallback = await playdl.default.stream(`ytsearch:${query}`);
                                    stream = fallback.stream;
                                    videoTitle = fallback.info?.videoDetails?.title || fallback.info?.title || result.title || 'Audio';
                                    videoDuration = fallback.info?.videoDetails?.lengthSeconds || 0;
                                } catch (err) {
                                    console.error('Search fallback error:', err.message);
                                    return interaction.editReply(`❌ Fehler beim Stream:\n\`\`\`${err.message}\`\`\``);
                                }
                            }

                        } catch (e) {
                            console.error('Search error:', e.message);
                            return interaction.editReply(`❌ Fehler bei der Suche:\n\`\`\`${e.message}\`\`\``);
                        }
                    }

                    if (!stream) {
                        return interaction.editReply('❌ Konnte Audio-Stream nicht erstellen.');
                    }

                    // Connect to voice channel
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator
                    });

                    // Create player
                    const player = createAudioPlayer();
                    connection.subscribe(player);

                    // Format duration
                    const durationStr = videoDuration ? `${Math.floor(videoDuration / 60)}:${(videoDuration % 60).toString().padStart(2, '0')}` : 'Unbekannt';

                    // Create and play resource
                    try {
                        const resource = createAudioResource(stream, {
                            inputType: StreamType.Arbitrary,
                            metadata: { title: videoTitle, duration: videoDuration }
                        });

                        player.play(resource);

                        await interaction.editReply(
                            `🎵 **${videoTitle}**\n` +
                            `⏱️ Dauer: ${durationStr}\n` +
                            `🔊 Lautstärke: ${volume}%\n\n` +
                            `✅ Wird jetzt abgespielt!`
                        );

                        // Handle end of stream
                        player.on(AudioPlayerStatus.Idle, () => {
                            try { connection.destroy(); } catch (_) {}
                        });

                        player.on('error', (error) => {
                            console.error('Player error:', error);
                        });

                    } catch (e) {
                        console.error('Resource creation error:', e);
                        return interaction.editReply(`❌ Fehler beim Abspielen:\n\`\`\`${e.message}\`\`\``);
                    }

                } catch (e) {
                    console.error('Voice/Player error:', e);
                    return interaction.editReply(`❌ Fehler:\n\`\`\`${e.message}\`\`\``);
                }

            } catch (e) {
                console.error('play handler error', e);
                await interaction.editReply({
                    content: `❌ Fehler beim Abspielen der Musik:\n\`\`\`${e.message}\`\`\``,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (e) {
            console.error('play command error', e);
        }
    });

    // Ski Animation Handler: /ski zeigt eine lustige Ski-Animation
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.__blocked) return;
            if (interaction.commandName !== 'ski') return;

            const skierName = interaction.user.username;
            const frames = [
                `🏔️ ${skierName} startet den Hang hinunter!`,
                `     ⛷️  ${skierName} fährt schneller!`,
                `          ⛷️  ${skierName} rast bergab!`,
                `               ⛷️  ${skierName} VORSICHT! 🌲`,
                `                    ⛷️  ${skierName} AUSWEICHEN! 🌲🌲`,
                `                         ⛷️  ${skierName} AHHHHHHH! 💨`,
                `🏁 ⛷️  ${skierName} ist angekommen! 🎉`,
                `✅ ${skierName} hat den Hang erfolgreich bezwungen! 🏆`
            ];

            const msg = await interaction.reply({
                content: frames[0],
                fetchReply: true
            });

            for (let i = 1; i < frames.length; i++) {
                await new Promise(r => setTimeout(r, 800));
                try {
                    await msg.edit({ content: frames[i] });
                } catch (e) {
                    console.warn('ski animation edit error', e);
                }
            }
        } catch (e) {
            console.error('ski handler error', e);
        }
    });

    // Info Handler: /info zeigt Informationen über den Bot
    client.on('interactionCreate', async interaction => {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.__blocked) return;
            if (interaction.commandName !== 'info') return;

            const uptime = Date.now() - BOT_START_TIME;
            const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
            const hours = Math.floor((uptime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((uptime % (1000 * 60)) / 1000);

            const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
            const guilds = client.guilds.cache.size;
            const users = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
            const memory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const version = process.version;

            const infoEmbed = {
                title: '🤖 Beast Bot - Informationen',
                description: 'Hier sind alle wichtigen Infos über den Bot!',
                color: 0x00FF00,
                fields: [
                    {
                        name: '⏱️ Uptime',
                        value: `\`${uptimeStr}\``,
                        inline: true
                    },
                    {
                        name: '🏢 Server',
                        value: `\`${guilds}\``,
                        inline: true
                    },
                    {
                        name: '👥 Nutzer',
                        value: `\`${users}\``,
                        inline: true
                    },
                    {
                        name: '💾 RAM-Nutzung',
                        value: `\`${memory}MB\``,
                        inline: true
                    },
                    {
                        name: '🔧 Node.js',
                        value: `\`${version}\``,
                        inline: true
                    },
                    {
                        name: '📚 Discord.js',
                        value: `\`v14\``,
                        inline: true
                    },
                    {
                        name: '👤 Ersteller',
                        value: `\`Beastmeds\``,
                        inline: false
                    },
                    {
                        name: '🎯 Features',
                        value: '✅ Musik abspielen\n✅ Voice-Channels\n✅ Moderation\n✅ Unterhaltung\n✅ Servereinrichtung',
                        inline: false
                    },
                    {
                        name: '🔗 Repository',
                        value: '[GitHub - Beast Bot Discord](https://github.com/Beastmeds/Beast-Bot-Discord)',
                        inline: false
                    }
                ],
                thumbnail: {
                    url: client.user.displayAvatarURL({ size: 512, dynamic: true })
                },
                footer: {
                    text: `Beast Bot v1.0 | Powered by Discord.js`,
                    icon_url: client.user.displayAvatarURL()
                }
            };

            await interaction.reply({
                embeds: [infoEmbed]
            });
        } catch (e) {
            console.error('info handler error', e);
            await interaction.reply({
                content: '❌ Fehler beim Abrufen der Bot-Informationen.',
                flags: MessageFlags.Ephemeral
            });
        }
    });

    // Add error handling for login
    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error('Failed to login:', error);
        process.exit(1);
    });

    // Handle any unhandled promise rejections
    process.on('unhandledRejection', error => {
        console.error('Unhandled promise rejection:', error);
    });
    