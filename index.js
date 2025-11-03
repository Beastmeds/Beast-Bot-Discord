import 'dotenv/config';
import { Client, GatewayIntentBits, Routes, PermissionFlagsBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import fetch from 'node-fetch';
import Canvas from 'canvas';
import fs from 'fs/promises';
import path from 'path';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
});

// Bot starten
client.once('ready', () => {
    console.log(`Bot ist online! Eingeloggt als ${client.user.tag}`);
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
                    { name: '🎵 Musik Server', value: 'musik' }
                ]
            }
        ]
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
        description: 'Lässt den Bot eine Nachricht senden (Admin only)',
        options: [{ name: 'message', description: 'Nachricht', type: 3, required: true }]
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
        await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

(async () => {
    try {
        console.log('Slash-Commands werden registriert...');
        console.log('Using CLIENT_ID:', CLIENT_ID);
        console.log('Using GUILD_ID:', GUILD_ID);
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('Slash-Commands erfolgreich registriert!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();

// Slash-Commands ausführen
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

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

    if (commandName === 'setup') {
        const typ = interaction.options.getString('typ');
        await interaction.deferReply();

        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return await interaction.editReply('Du brauchst die Berechtigung "Kanäle verwalten" für diesen Befehl! ❌');
            }

            const categoryStructure = {
                'gaming': {
                    '🎮 Gaming': ['🎯-allgemein', '🎲-lobby', '🏆-turniere'],
                    '🔊 Voice': ['🎮-gaming-1', '🎮-gaming-2', '🎵-musik'],
                    '📢 Info': ['📜-regeln', '📢-ankündigungen']
                },
                'community': {
                    '💬 Community': ['🗣️-chat', '🤝-vorstellung', '🎉-events'],
                    '🔊 Voice': ['🗣️-talk-1', '🗣️-talk-2', '🎵-musik'],
                    '📢 Info': ['📜-regeln', '📢-news']
                },
                'musik': {
                    '🎵 Musik': ['🎵-musik-chat', '🎼-song-wünsche', '🎸-künstler'],
                    '🔊 Voice': ['🎵-musik-1', '🎵-musik-2', '🎤-karaoke'],
                    '📢 Info': ['📜-regeln', '📢-events']
                }
            };

            const structure = categoryStructure[typ];
            for (const [categoryName, channels] of Object.entries(structure)) {
                const category = await interaction.guild.channels.create({
                    name: categoryName,
                    type: 4 // CategoryChannel
                });

                for (const channelName of channels) {
                    await interaction.guild.channels.create({
                        name: channelName,
                        type: channelName.startsWith('🔊') ? 2 : 0, // 2 for voice, 0 for text
                        parent: category.id
                    });
                }
            }

            await interaction.editReply(`Server-Setup für "${typ}" wurde erfolgreich erstellt! ✅`);
        } catch (error) {
            console.error(error);
            await interaction.editReply('Es gab einen Fehler beim Erstellen der Server-Struktur! ❌');
        }
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
                // Künstlerische Pinselstriche
                ctx.strokeStyle = '#ffffff33';
                for (let i = 0; i < 5; i++) {
                    ctx.beginPath();
                    ctx.arc(Math.random() * 800, Math.random() * 800, 100, 0, Math.PI * 2);
                    ctx.stroke();
                }
            } else if (stil === 'cyber') {
                // Cyber-Grid
                ctx.strokeStyle = '#00ffff33';
                for (let i = 0; i < 800; i += 50) {
                    ctx.beginPath();
                    ctx.moveTo(i, 0);
                    ctx.lineTo(i, 800);
                    ctx.stroke();
                    ctx.moveTo(0, i);
                    ctx.lineTo(800, i);
                    ctx.stroke();
                }
            }

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
            return await interaction.reply({ content: 'Du brauchst die Berechtigung "Server verwalten".', ephemeral: true });
        }

        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].welcomeChannelId = channel.id;
        await saveConfig(cfg);
        return await interaction.reply({ content: `Willkommens-Channel wurde gesetzt: ${channel}`, ephemeral: false });
    }

    if (commandName === 'test-welcome') {
        await interaction.deferReply({ ephemeral: true });
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
            return await interaction.reply({ content: 'Du brauchst die Berechtigung "Rollen verwalten".', ephemeral: true });
        }
        const cfg = await loadConfig();
        cfg[interaction.guild.id] = cfg[interaction.guild.id] || {};
        cfg[interaction.guild.id].autoroleId = role.id;
        await saveConfig(cfg);
        return await interaction.reply({ content: `Autorole wurde gesetzt: ${role.name}`, ephemeral: false });
    }
});
// (Note: earlier code continues) -- we'll re-open listener area and add handlers just after the existing interactionCreate body

// Append additional handler code by listening again for interactions (safe to do)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === '8ball') {
        const q = interaction.options.getString('question');
        const answers = [
            'Ja.', 'Nein.', 'Vielleicht.', 'Definitiv.', 'Frag später nochmal.', 'Ich bin mir nicht sicher.', 'Auf jeden Fall nicht.', 'Absolute Yes.'
        ];
        const pick = answers[Math.floor(Math.random() * answers.length)];
        await interaction.reply({ content: `🎱 Frage: ${q}\nAntwort: **${pick}**` });
    }

    if (commandName === 'poll') {
        const q = interaction.options.getString('question');
        const msg = await interaction.reply({ content: `📊 **Umfrage:** ${q}`, fetchReply: true });
        try {
            await msg.react('✅');
            await msg.react('❌');
        } catch (e) { console.error('React poll error', e); }
    }

    if (commandName === 'say') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: 'Nur Admins dürfen das verwenden.', ephemeral: true });
        const text = interaction.options.getString('message');
        await interaction.reply({ content: 'Nachricht gesendet.', ephemeral: true });
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
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return interaction.reply({ content: 'Du brauchst Manage Messages.', ephemeral: true });
        if (amount < 1 || amount > 100) return interaction.reply({ content: 'Anzahl zwischen 1 und 100.', ephemeral: true });
        try {
            const deleted = await interaction.channel.bulkDelete(amount, true);
            await interaction.reply({ content: `Gelöscht: ${deleted.size} Nachrichten.`, ephemeral: true });
        } catch (e) {
            console.error('purge error', e);
            await interaction.reply({ content: 'Fehler beim Löschen (nachrichten älter als 14 Tage?).', ephemeral: true });
        }
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
                    await ch.send({ embeds: [{ title: `Willkommen auf ${member.guild.name}!`, description: `Hallo ${member.toString()}, schön dass du da bist!`, thumbnail: { url: member.displayAvatarURL({ dynamic: true }) } }] });
                } catch (e) { console.error('Welcome message error:', e); }
            }
        }
    } catch (e) {
        console.error('guildMemberAdd handler error:', e);
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
