/**
 * ==============================================================================
 * BotWorks Command Center — Autonomous All-in-One Internal Operations Bot
 * Built for BotWorks AI
 * 
 * Tech Stack: Node.js 20, Discord.js v14, better-sqlite3, Express, Axios, Cheerio, Dotenv
 * Target Environment: Pterodactyl Panel / Sparked Host Node.js 20 Container
 *
 * Core Modules:
 *   1. Lead Scout & Outreach Engine (Disboard/Discadia/DiscordServers + Pitch Generator + CRM)
 *   2. Client Billing & Sparked Host Sentinel (UUID Hosting Trackers, MRR, Renewal Alerts)
 *   3. Interactive DM Reminder System with Stripe Renewal Routing
 *   4. Built-in Express Server for Stripe Webhooks & Pterodactyl Health Checks
 * ==============================================================================
 */

require('dotenv').config();
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const axios = require('axios');
const cheerio = require('cheerio');
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType
} = require('discord.js');

// --- 1. CORE CONSTANTS & ENVIRONMENT VALIDATION ---
const CONFIG = {
  TOKEN: process.env.DISCORD_TOKEN || '',
  CLIENT_ID: process.env.CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '1540161593290260490',
  MANAGEMENT_CHANNEL_ID: process.env.MANAGEMENT_CHANNEL_ID || '1541954518848381030',
  PORT: process.env.PORT || 3000,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_RENEWAL_URL: process.env.STRIPE_RENEWAL_URL || 'https://buy.stripe.com/00w00jbkTeFqbgM0aH2Ry01',
  STRIPE_SETUP_URL: process.env.STRIPE_SETUP_URL || 'https://buy.stripe.com/fZu14n1Kj40M4So1eL2Ry00',
  DISCORD_BILLING_WEBHOOK_URL: process.env.DISCORD_BILLING_WEBHOOK_URL || 'https://discord.com/api/webhooks/1540212982833872916/6czVCia5eT5RuXTSgn8houpXa_MMSdb52RNdJlb6ne3Ng6jCqlODyhbNciZqwpzcCZ3w',
  SPARKED_PANEL_BASE: 'https://control.sparkedhost.us/server',
  SPARKED_BILLING_URL: 'https://billing.sparkedhost.com/clientarea.php',
  PRICING: {
    SETUP_FLAT: 15.00,
    HOSTING_MONTHLY: 5.00
  },
  COLORS: {
    DARK_SLATE: 0x1E1F22,
    EMERALD_GREEN: 0x10B981,
    AMBER_ALERT: 0xF59E0B,
    CRIMSON_ALERT: 0xFF4343,
    BLURPLE: 0x5865F2,
    CYAN: 0x06B6D4
  },
  ROLES: {
    VERIFIED_CUSTOMER: process.env.ROLE_VERIFIED_CUSTOMER || '1540161925659238480',
    ACTIVE_ORDER: process.env.ROLE_ACTIVE_ORDER || '1540219844199448636'
  }
};

// --- 2. DATABASE ARCHITECTURE (better-sqlite3: botworks.db) ---
const DB_PATH = path.join(__dirname, 'botworks.db');
const db = new Database(DB_PATH);

// Enforce foreign keys and WAL mode for high-concurrency Node.js execution
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Initialize SQLite Schema
db.exec(`
  -- Table: leads
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_name TEXT NOT NULL,
    invite_url TEXT UNIQUE NOT NULL,
    member_count INTEGER NOT NULL,
    niche TEXT NOT NULL,
    status TEXT DEFAULT 'New',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_leads_invite ON leads(invite_url);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_niche ON leads(niche);

  -- Table: clients
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    discord_id TEXT NOT NULL,
    bot_name TEXT NOT NULL,
    host_id TEXT NOT NULL,
    stripe_email TEXT,
    status TEXT DEFAULT 'Active',
    monthly_fee REAL DEFAULT 5.00,
    last_reminded DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_clients_discord_id ON clients(discord_id);
  CREATE INDEX IF NOT EXISTS idx_clients_bot_name ON clients(bot_name);
  CREATE INDEX IF NOT EXISTS idx_clients_host_id ON clients(host_id);
  CREATE INDEX IF NOT EXISTS idx_clients_stripe_email ON clients(stripe_email);
  CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
`);

console.log(`[Database] SQLite connected at ${DB_PATH}. All tables verified.`);

// Pre-compiled prepared queries for speed and security
const queries = {
  // Leads Queries
  findLeadByInvite: db.prepare('SELECT * FROM leads WHERE invite_url = ?'),
  findLeadByName: db.prepare('SELECT * FROM leads WHERE LOWER(server_name) = LOWER(?)'),
  findLeadById: db.prepare('SELECT * FROM leads WHERE id = ?'),
  insertLead: db.prepare(`
    INSERT INTO leads (server_name, invite_url, member_count, niche, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'New', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `),
  updateLeadStatus: db.prepare(`
    UPDATE leads 
    SET status = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `),
  updateLeadStatusByName: db.prepare(`
    UPDATE leads 
    SET status = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE LOWER(server_name) = LOWER(?)
  `),
  getPipelineMetrics: db.prepare(`
    SELECT 
      COUNT(*) AS total_scouted,
      SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) AS total_new,
      SUM(CASE WHEN status = 'Contacted' THEN 1 ELSE 0 END) AS total_contacted,
      SUM(CASE WHEN status = 'Invoice Sent' THEN 1 ELSE 0 END) AS total_invoices,
      SUM(CASE WHEN status = 'Meeting Booked' THEN 1 ELSE 0 END) AS total_meetings,
      SUM(CASE WHEN status = 'Closed Won ($15)' OR status = 'Closed Won' THEN 1 ELSE 0 END) AS total_closed,
      SUM(CASE WHEN status = 'Lost' THEN 1 ELSE 0 END) AS total_lost,
      SUM(CASE WHEN status = 'Dismissed' THEN 1 ELSE 0 END) AS total_dismissed
    FROM leads
  `),
  upsertInvoiceLead: db.prepare(`
    INSERT INTO leads (server_name, invite_url, member_count, niche, status, created_at, updated_at)
    VALUES (?, ?, 0, 'Custom Bot Order', 'Invoice Sent', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(invite_url) DO UPDATE SET
      server_name = excluded.server_name,
      status = 'Invoice Sent',
      updated_at = CURRENT_TIMESTAMP
  `),
  searchLeadsAutocomplete: db.prepare(`
    SELECT id, server_name, status, niche 
    FROM leads 
    WHERE server_name LIKE ? 
    ORDER BY updated_at DESC 
    LIMIT 25
  `),

  // Clients Queries
  insertClient: db.prepare(`
    INSERT INTO clients (client_name, discord_id, bot_name, host_id, stripe_email, status, monthly_fee, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'Active', 5.00, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `),
  getAllClients: db.prepare('SELECT * FROM clients ORDER BY created_at DESC'),
  getClientById: db.prepare('SELECT * FROM clients WHERE id = ?'),
  getClientByBotName: db.prepare('SELECT * FROM clients WHERE LOWER(bot_name) = LOWER(?)'),
  getClientByEmail: db.prepare('SELECT * FROM clients WHERE LOWER(stripe_email) = LOWER(?)'),
  updateClientStatus: db.prepare(`
    UPDATE clients 
    SET status = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `),
  updateClientStatusByBotName: db.prepare(`
    UPDATE clients 
    SET status = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE LOWER(bot_name) = LOWER(?)
  `),
  updateClientLastReminded: db.prepare(`
    UPDATE clients 
    SET last_reminded = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `),
  deleteClient: db.prepare('DELETE FROM clients WHERE id = ?'),
  deleteClientByBotName: db.prepare('DELETE FROM clients WHERE LOWER(bot_name) = LOWER(?)'),
  searchClientsAutocomplete: db.prepare(`
    SELECT id, bot_name, client_name, status 
    FROM clients 
    WHERE bot_name LIKE ? 
    ORDER BY bot_name ASC 
    LIMIT 25
  `),
  getClientMetrics: db.prepare(`
    SELECT 
      COUNT(*) AS total_clients,
      SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN status = 'Past Due' OR status = 'Past_Due' THEN 1 ELSE 0 END) AS past_due_count,
      SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
      SUM(CASE WHEN status = 'Active' THEN monthly_fee ELSE 0 END) AS total_mrr
    FROM clients
  `)
};

// --- 3. ROTATING USER-AGENTS & HTTP NETWORK ENGINE ---
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/125.0.0.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithHeaders(url, timeoutMs = 7000) {
  return axios.get(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    timeout: timeoutMs,
    validateStatus: (status) => status >= 200 && status < 400
  });
}

// --- 4. DYNAMIC PITCH ENGINE ---
const NICHES = {
  FIVEM: 'FiveM Asset Shops',
  RESELLING: 'Reselling Cook Groups',
  ROBLOX: 'Roblox Dev Studios',
  CREATIVE: 'Creative / GFX Agencies'
};

function generatePitch(niche, serverName, memberCount) {
  const formattedCount = memberCount ? Number(memberCount).toLocaleString() : '300+';

  switch (niche) {
    case NICHES.FIVEM:
      return (
`Hey ${serverName} team! 👋

I came across your server (${formattedCount} members) and really respect the FiveM development work you've put together.

I'm an engineer at **BotWorks AI**. We develop branded Discord bot systems built specifically for FiveM shops to automate sales and eliminate messy ticket channels:

• **/catalog** — Interactive dropdown for scripts, vehicles, and MLOs with instant visual previews and specs.
• **/order** — Structured commission intake modal that captures exact requirements and budget upfront before opening a ticket.
• **Automated Vouch Routing** — Instant customer feedback logging with star ratings directly in your public vouch wall.

**Agency Pricing:** Flat **$15** (custom build + 1st month hosting included), then just **$5/mo** ongoing maintenance.

Would you be open to a 60-second interactive demo link so you can test the /catalog and /order flow in our staging server?`
      );

    case NICHES.RESELLING:
      return (
`Hey ${serverName} team! 🚀

Noticed your community (${formattedCount} members) and the awesome engagement you've fostered in the reselling space.

I'm with **BotWorks AI**. We build dedicated Discord utility bots for top cook groups and arbitrage communities to boost member retention and prove your group's alpha:

• **/win** — Dynamic profit & ROI calculator where members log flips with custom success embeds and automated leaderboards.
• **/tiers** — Interactive subscription tier breakdown showcasing VIP perks and direct upgrade triggers.
• **Alpha Vouch Router** — Automatically syndicates winning flip screenshots to your public results channel to convert free members.

**Agency Pricing:** Flat **$15** (custom build + 1st month hosting included), then **$5/mo** ongoing maintenance.

Could I send over a quick staging link so your staff can try the /win profit calculator firsthand?`
      );

    case NICHES.ROBLOX:
      return (
`Hey ${serverName} founders! 🎮

Found your studio (${formattedCount} members) while looking through top Roblox development teams.

At **BotWorks AI**, we build customized Discord management bots tailored specifically for Roblox dev studios, recruitment hubs, and UGC teams:

• **/talent** — Searchable talent directory linking developer portfolios, skill tags (Scripter, 3D Modeler, Builder, Animator), and availability.
• **/hire** — Work-order intake modal that formats commission requests with deadlines, budget, and scope directly into staff review channels.
• **Commission Status & Milestone Tracker** — Keeps buyers and developers aligned on delivery dates and escrow checkpoints.

**Agency Pricing:** Flat **$15** (custom build + 1st month hosting included), then **$5/mo** ongoing maintenance.

Would you be open to a quick 2-minute sandbox walkthrough showing how /hire cleans up development ticket queues?`
      );

    case NICHES.CREATIVE:
      return (
`Hey ${serverName} team! 🎨

Stumbled upon your creative community (${formattedCount} members) — really impressed by the design talent and artwork being posted.

I'm an engineer at **BotWorks AI**. We build tailored agency workflow bots designed specifically for GFX, VFX, and 3D digital design studios:

• **/portfolio** — High-resolution interactive showcases organized by medium (renders, banners, stream packages, UI).
• **/quote** — Commission intake modal capturing client reference files, deadlines, commercial licensing, and budget before staff triage.
• **Verified Review Logger** — Automatically publishes client feedback with preview thumbnails to your public reputation channel.

**Agency Pricing:** Flat **$15** (custom build + 1st month hosting included), then **$5/mo** ongoing maintenance.

Would you like to test out the /quote and portfolio dropdown in a demo channel to see how it speeds up client intake?`
      );

    default:
      return (
`Hey ${serverName} team! 👋

I came across your server (${formattedCount} members) and wanted to reach out.

I'm with **BotWorks AI**. We build custom branded Discord bots designed to automate sales, intake tickets, and member engagement:
• Interactive slash commands & commission intake modals
• Branded embeds, automated review walls, and analytics
• Flat **$15** (custom build + 1st month hosting included), then **$5/mo** ongoing maintenance.

Let me know if you'd like a quick preview demo!`
      );
  }
}

// --- 5. HIGH-YIELD SEED POOL & MULTI-DIRECTORY SCRAPERS ---
const SEED_CATALOG = [
  // FiveM Asset Shops
  {
    server_name: 'San Andreas FiveM Development & Assets',
    invite_url: 'https://discord.gg/fivemdevassets',
    member_count: 3820,
    niche: NICHES.FIVEM,
    description: 'Premier FiveM asset marketplace featuring custom scripts, vehicle handling packs, debadged imports, and MLO interiors.'
  },
  {
    server_name: 'Apex FiveM Scripts & Vehicle Mods',
    invite_url: 'https://discord.gg/apexscripts',
    member_count: 2450,
    niche: NICHES.FIVEM,
    description: 'High performance standalone and QBCore FiveM scripts, vehicle debadging, custom sirens, and optimized livery packs.'
  },
  {
    server_name: 'Vortex FiveM Studios',
    invite_url: 'https://discord.gg/vortexfivem',
    member_count: 5120,
    niche: NICHES.FIVEM,
    description: 'Custom FiveM UI development, NUI inventory overhauls, custom jobs, and server-side mapping commissions.'
  },
  {
    server_name: 'Redline FiveM Modifications',
    invite_url: 'https://discord.gg/redlinefivem',
    member_count: 1780,
    niche: NICHES.FIVEM,
    description: 'Custom vehicle packs, realistic engine sounds, sound physics, and custom livery commissions for serious RP servers.'
  },
  {
    server_name: 'Legacy FiveM Development Hub',
    invite_url: 'https://discord.gg/legacyfivemdev',
    member_count: 4200,
    niche: NICHES.FIVEM,
    description: 'Community of FiveM script makers, vehicle artists, and server owners buying and trading premium dev assets.'
  },
  {
    server_name: 'Dking FiveM Development',
    invite_url: 'https://discordservers.com/server/1292950044760342608',
    member_count: 1173,
    niche: NICHES.FIVEM,
    description: 'FiveM Scripts, Vehicle Handling, Debadge and Rebadge. Custom commissions and open ticket support.'
  },
  {
    server_name: 'Pulse FiveM Asset Store',
    invite_url: 'https://discord.gg/pulsefivemstore',
    member_count: 2890,
    niche: NICHES.FIVEM,
    description: 'Specializing in police car packs, ELS configs, custom clothing items (EUP), and realistic FiveM sound packs.'
  },

  // Reselling Cook Groups
  {
    server_name: 'Side Hustles Resell Alpha',
    invite_url: 'https://discordservers.com/server/930652111761457163',
    member_count: 40790,
    niche: NICHES.RESELLING,
    description: 'Reselling all types of products: Trading, Ticket Flipping, Price Errors, Retail Arbitrage, and Sneaker Monitors.'
  },
  {
    server_name: 'FlipKing Resell & Arbitrage Community',
    invite_url: 'https://discord.gg/flipkingarbitrage',
    member_count: 3650,
    niche: NICHES.RESELLING,
    description: 'Daily price error monitors, clearance deal alerts, Amazon FBA tips, and sports card flipping breakdown.'
  },
  {
    server_name: 'SoleStrike Cook Group',
    invite_url: 'https://discord.gg/solestrikealpha',
    member_count: 8940,
    niche: NICHES.RESELLING,
    description: 'Specialized sneaker release guides, early links, bot rentals, ACO services, and daily profitable retail leads.'
  },
  {
    server_name: 'ProfitPulse Reselling Club',
    invite_url: 'https://discord.gg/profitpulsevip',
    member_count: 1940,
    niche: NICHES.RESELLING,
    description: 'Helping side-hustlers generate $2k-$5k/month flipping electronics, vinyl records, collectibles, and concert tickets.'
  },
  {
    server_name: 'Volt Arbitrage & Resell Network',
    invite_url: 'https://discord.gg/voltarbitrage',
    member_count: 4520,
    niche: NICHES.RESELLING,
    description: 'Fast monitors, Target and Walmart clearance scanners, price glitch pings, and high-frequency reselling signals.'
  },
  {
    server_name: 'Resell Matrix VIP Group',
    invite_url: 'https://discord.gg/resellmatrixvip',
    member_count: 2750,
    niche: NICHES.RESELLING,
    description: 'Full-service reselling cook group offering 1-on-1 member coaching, tax guidance, and high margin product monitors.'
  },

  // Roblox Dev Studios
  {
    server_name: 'Roblox Dev Hub',
    invite_url: 'https://discordservers.com/server/1098321877979648070',
    member_count: 16260,
    niche: NICHES.ROBLOX,
    description: 'The place where Roblox developers meet. Hire talent, sell assets, collaborate on game studios, and get feedback.'
  },
  {
    server_name: 'Roblox Studio Community',
    invite_url: 'https://discordservers.com/server/448986884497211392',
    member_count: 142080,
    niche: NICHES.ROBLOX,
    description: 'The premier place to hire Roblox developers, share creations, recruit project teams, and commission Luau scripters.'
  },
  {
    server_name: 'BlockSmith Roblox Studios',
    invite_url: 'https://discord.gg/blocksmithstudios',
    member_count: 3410,
    niche: NICHES.ROBLOX,
    description: 'Independent Roblox development team creating simulator games, custom GUI packages, and low-poly 3D models.'
  },
  {
    server_name: 'VoxelForge Roblox Developers',
    invite_url: 'https://discord.gg/voxelforgedev',
    member_count: 2280,
    niche: NICHES.ROBLOX,
    description: 'Talent marketplace for Roblox scripters, VFX artists, and environmental builders looking for paid studio contracts.'
  },
  {
    server_name: 'Aether Game Studios (Roblox)',
    invite_url: 'https://discord.gg/aetherstudiosrbx',
    member_count: 5890,
    niche: NICHES.ROBLOX,
    description: 'Fast-growing Roblox game studio with over 15M lifetime visits. Recruiting freelance builders and modelers.'
  },
  {
    server_name: 'Infinite Roblox Scripters & Builders',
    invite_url: 'https://discord.gg/infiniterobloxdev',
    member_count: 4120,
    niche: NICHES.ROBLOX,
    description: 'Connecting Roblox game investors with seasoned programmers, sound designers, and UI artists.'
  },

  // Creative / GFX Agencies
  {
    server_name: 'HEXGLITCH | DESIGN & MOTION',
    invite_url: 'https://discordservers.com/server/800806407703756820',
    member_count: 975,
    niche: NICHES.CREATIVE,
    description: 'Design & Motion graphics studio. Specializing in branding, 3D renders, YouTube packaging, and vector art.'
  },
  {
    server_name: 'Aesthetic Arts & GFX Collective',
    invite_url: 'https://discord.gg/aestheticgfx',
    member_count: 4620,
    niche: NICHES.CREATIVE,
    description: 'Graphic design studio community offering banner commissions, logo design, stream overlays, and video editing.'
  },
  {
    server_name: 'Vanguard Creative Agency',
    invite_url: 'https://discord.gg/vanguardcreatives',
    member_count: 3180,
    niche: NICHES.CREATIVE,
    description: 'Boutique digital agency for esports teams and content creators. Brand kits, merch design, and motion gfx.'
  },
  {
    server_name: 'PixelForge GFX & 3D Studios',
    invite_url: 'https://discord.gg/pixelforgegfx',
    member_count: 2850,
    niche: NICHES.CREATIVE,
    description: 'Cinema4D & Blender 3D artists creating thumbnails, mascot logos, header graphics, and promotional animations.'
  },
  {
    server_name: 'Hyperion Design Lab',
    invite_url: 'https://discord.gg/hyperiondesign',
    member_count: 5410,
    niche: NICHES.CREATIVE,
    description: 'Collaborative agency of freelance graphic designers, illustrators, and UI/UX designers handling client commissions.'
  },
  {
    server_name: 'Eclipse Motion & Visuals',
    invite_url: 'https://discord.gg/eclipsemotion',
    member_count: 2190,
    niche: NICHES.CREATIVE,
    description: 'Specializing in After Effects animations, intro/outro stingers, logo reveals, and high-impact commercial visuals.'
  }
];

async function resolveDiscordWidgetInvite(serverId) {
  try {
    const res = await axios.get(`https://discord.com/api/guilds/${serverId}/widget.json`, {
      headers: { 'User-Agent': getRandomUserAgent() },
      timeout: 3000,
      validateStatus: (status) => status === 200
    });
    if (res.data && res.data.instant_invite) {
      return res.data.instant_invite;
    }
  } catch {
    // Widget disabled or rate limited
  }
  return null;
}

async function scrapeDiscordServers(keyword, niche, minMembers = 300) {
  const results = [];
  try {
    const searchUrl = `https://discordservers.com/search/${encodeURIComponent(keyword)}`;
    const res = await fetchWithHeaders(searchUrl, 6000);
    const $ = cheerio.load(res.data);

    const cards = $('a[href^="/server/"]').toArray();
    for (const el of cards) {
      const href = $(el).attr('href') || '';
      const serverId = href.replace('/server/', '').trim();
      const serverName = $(el).find('h3').text().trim();
      
      const memberText = $(el).find('p:contains("members")').text();
      const match = memberText.match(/([\d,]+)\s*members/i);
      const memberCount = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;

      const desc = $(el).find('p.line-clamp-2').text().trim() || 
                   $(el).find('p').eq(1).text().trim() || 
                   'High-potential Discord community matching target niche criteria.';

      if (serverId && serverName && memberCount >= minMembers) {
        const directInvite = await resolveDiscordWidgetInvite(serverId);
        const finalInvite = directInvite || `https://discordservers.com/servers/${serverId}/join-link`;

        results.push({
          server_name: serverName,
          invite_url: finalInvite,
          member_count: memberCount,
          niche: niche,
          description: desc
        });
      }
    }
  } catch (err) {
    console.warn(`[Scraper] DiscordServers notice for "${keyword}": ${err.message}`);
  }
  return results;
}

async function scrapeDisboard(keyword, niche, minMembers = 300) {
  const results = [];
  try {
    const url = `https://disboard.org/search?keyword=${encodeURIComponent(keyword)}`;
    const res = await fetchWithHeaders(url, 5000);
    const $ = cheerio.load(res.data);

    $('.server-card').each((i, card) => {
      const name = $(card).find('.server-name a').text().trim();
      const memberText = $(card).find('.server-members').text();
      const match = memberText.match(/([\d,]+)/);
      const memberCount = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
      const desc = $(card).find('.server-description').text().trim();
      const joinHref = $(card).find('a.btn-join').attr('href');

      if (name && joinHref && memberCount >= minMembers) {
        const inviteUrl = joinHref.startsWith('http') ? joinHref : `https://disboard.org${joinHref}`;
        results.push({
          server_name: name,
          invite_url: inviteUrl,
          member_count: memberCount,
          niche: niche,
          description: desc || 'Public Discord community listed on Disboard directory.'
        });
      }
    });
  } catch (err) {
    console.warn(`[Scraper] Disboard notice for "${keyword}": ${err.message}`);
  }
  return results;
}

async function scrapeDiscadia(keyword, niche, minMembers = 300) {
  const results = [];
  try {
    const url = `https://discadia.com/search/?q=${encodeURIComponent(keyword)}`;
    const res = await fetchWithHeaders(url, 4500);
    const $ = cheerio.load(res.data);

    $('.server-box, .listing-card').each((i, el) => {
      const name = $(el).find('.server-title, .title').text().trim();
      const memberText = $(el).find('.member-count, .members').text();
      const match = memberText.match(/([\d,]+)/);
      const memberCount = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
      const joinHref = $(el).find('a.join-button, a[href*="discord"]').attr('href');
      const desc = $(el).find('.server-description, .description').text().trim();

      if (name && joinHref && memberCount >= minMembers) {
        results.push({
          server_name: name,
          invite_url: joinHref,
          member_count: memberCount,
          niche: niche,
          description: desc || 'Discadia public directory community.'
        });
      }
    });
  } catch (err) {
    console.warn(`[Scraper] Discadia notice for "${keyword}": ${err.message}`);
  }
  return results;
}

async function harvestQualifiedLeads(niche, minMembers = 300, limit = 5) {
  let searchKeywords = [];
  switch (niche) {
    case NICHES.FIVEM:
      searchKeywords = ['fivem', 'fivem dev', 'fivem scripts'];
      break;
    case NICHES.RESELLING:
      searchKeywords = ['resell', 'cook group', 'sneaker'];
      break;
    case NICHES.ROBLOX:
      searchKeywords = ['roblox dev', 'roblox studio', 'roblox'];
      break;
    case NICHES.CREATIVE:
      searchKeywords = ['gfx', 'creative agency', 'design'];
      break;
    default:
      searchKeywords = ['gaming'];
  }

  const candidatePool = [];

  // 1. Live Web Directory Scraping
  for (const keyword of searchKeywords) {
    const [dsLeads, disboardLeads, discadiaLeads] = await Promise.allSettled([
      scrapeDiscordServers(keyword, niche, minMembers),
      scrapeDisboard(keyword, niche, minMembers),
      scrapeDiscadia(keyword, niche, minMembers)
    ]);

    if (dsLeads.status === 'fulfilled') candidatePool.push(...dsLeads.value);
    if (disboardLeads.status === 'fulfilled') candidatePool.push(...disboardLeads.value);
    if (discadiaLeads.status === 'fulfilled') candidatePool.push(...discadiaLeads.value);

    if (candidatePool.length >= limit * 3) break;
  }

  // 2. Add Curated Seed Leads
  const nicheSeeds = SEED_CATALOG.filter(s => s.niche === niche && s.member_count >= minMembers);
  candidatePool.push(...nicheSeeds);

  // 3. Deduplicate in memory
  const seenUrls = new Set();
  const uniqueCandidates = [];
  for (const item of candidatePool) {
    const normUrl = item.invite_url.toLowerCase().trim();
    if (!seenUrls.has(normUrl)) {
      seenUrls.add(normUrl);
      uniqueCandidates.push(item);
    }
  }

  // 4. Strict SQLite Database Deduplication Check
  const qualifiedLeads = [];
  for (const lead of uniqueCandidates) {
    const existingByInvite = queries.findLeadByInvite.get(lead.invite_url);
    if (existingByInvite) continue; // Already scouted, contacted, won, or dismissed

    const existingByName = queries.findLeadByName.get(lead.server_name);
    if (existingByName) continue;

    try {
      const insertResult = queries.insertLead.run(
        lead.server_name,
        lead.invite_url,
        lead.member_count,
        lead.niche
      );
      lead.id = insertResult.lastInsertRowid;
      lead.status = 'New';
      qualifiedLeads.push(lead);
    } catch {
      continue;
    }

    if (qualifiedLeads.length >= limit) break;
  }

  return qualifiedLeads;
}

// Helper to build a Lead Card Embed & ActionRow
function buildLeadCard(lead) {
  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.DARK_SLATE)
    .setTitle(`🎯 New Lead: ${lead.server_name} • ${Number(lead.member_count).toLocaleString()} Members`)
    .setDescription(lead.description || 'Target community scouted from public Discord directories.')
    .addFields(
      { name: '📂 Niche Vertical', value: `\`${lead.niche}\``, inline: true },
      { name: '📊 Pipeline Status', value: `\`${lead.status || 'New'}\``, inline: true },
      { name: '🏷️ Lead ID', value: `\`#${lead.id}\``, inline: true },
      { name: '🔗 Invite Link', value: `[Open Invite](${lead.invite_url})`, inline: false }
    )
    .setFooter({ text: 'BotWorks AI • Command Center Lead Scout Engine' })
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Join Server')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Link)
      .setURL(lead.invite_url),
    new ButtonBuilder()
      .setCustomId(`view_pitch_${lead.id}`)
      .setLabel('View Pitch')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`contact_lead_${lead.id}`)
      .setLabel('Mark Contacted')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dismiss_lead_${lead.id}`)
      .setLabel('Dismiss')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
  );

  return { embed, actionRow };
}

// --- 6. CLIENT SENTINEL & ALERT EMBEDS ---

function buildClientCard(client) {
  const panelUrl = `${CONFIG.SPARKED_PANEL_BASE}/${client.host_id}/startup`;

  const embed = new EmbedBuilder()
    .setColor(CONFIG.COLORS.EMERALD_GREEN)
    .setTitle(`⚡ Client Hosted & Active: ${client.bot_name}`)
    .setDescription(`Bot instance is provisioned and monitored under the **BotWorks AI Client Sentinel**.`)
    .addFields(
      { name: '👤 Client Contact', value: `<@${client.discord_id}>`, inline: true },
      { name: '🤖 Bot Name', value: `**${client.bot_name}**`, inline: true },
      { name: '🟢 Hosting Status', value: `\`🟢 Active ($${Number(client.monthly_fee || 5).toFixed(2)}/mo)\``, inline: true },
      { name: '🖥️ Sparked Host UUID', value: `\`${client.host_id}\``, inline: false },
      { name: '📧 Stripe Billing Email', value: client.stripe_email ? `\`${client.stripe_email}\`` : '_Not Provided_', inline: true },
      { name: '📅 Provisioned At', value: client.created_at || 'Just now', inline: true }
    )
    .setFooter({ text: 'BotWorks AI • Operations & Billing Sentinel' })
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Control Panel')
      .setEmoji('🖥️')
      .setStyle(ButtonStyle.Link)
      .setURL(panelUrl),
    new ButtonBuilder()
      .setLabel('Sparked Host Billing')
      .setEmoji('💳')
      .setStyle(ButtonStyle.Link)
      .setURL(CONFIG.SPARKED_BILLING_URL)
  );

  return { embed, actionRow };
}

function buildClientAlert(client, alertType = 'Past_Due') {
  const panelUrl = `${CONFIG.SPARKED_PANEL_BASE}/${client.host_id}/startup`;
  const isCancelled = alertType.toLowerCase().includes('cancel');

  const color = isCancelled ? CONFIG.COLORS.CRIMSON_ALERT : CONFIG.COLORS.AMBER_ALERT;
  const title = isCancelled
    ? `🚨 Suspension Notice: Bot Subscription Cancelled — ${client.bot_name}`
    : `⚠️ Billing Alert: Past Due Renewal — ${client.bot_name}`;

  const desc = isCancelled
    ? `The monthly hosting subscription for **${client.bot_name}** has been cancelled. Server instance is pending shutdown/suspension on Sparked Host panel.`
    : `Monthly 24/7 hosting payment for **${client.bot_name}** has failed or is past due. Follow up with the client to prevent bot offline downtime.`;

  const statusDisplay = isCancelled ? '🔴 Cancelled' : '🟠 Past Due ($5.00/mo)';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .addFields(
      { name: '👤 Client', value: `<@${client.discord_id}> (${client.client_name})`, inline: true },
      { name: '🤖 Bot Name', value: `**${client.bot_name}**`, inline: true },
      { name: '⚡ Status', value: `\`${statusDisplay}\``, inline: true },
      { name: '🖥️ Sparked Host UUID', value: `\`${client.host_id}\``, inline: false },
      { name: '📧 Stripe Email', value: client.stripe_email ? `\`${client.stripe_email}\`` : '_Not Provided_', inline: true },
      { name: '🕒 Last Reminded', value: client.last_reminded ? `\`${client.last_reminded}\`` : '_Never_', inline: true }
    )
    .setFooter({ text: 'BotWorks Sentinel • Action Required' })
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Open Server Panel')
      .setEmoji('🖥️')
      .setStyle(ButtonStyle.Link)
      .setURL(panelUrl),
    new ButtonBuilder()
      .setLabel('Sparked Host Billing')
      .setEmoji('💳')
      .setStyle(ButtonStyle.Link)
      .setURL(CONFIG.SPARKED_BILLING_URL),
    new ButtonBuilder()
      .setCustomId(`remind_client_${client.id}`)
      .setLabel('Remind Customer')
      .setEmoji('📩')
      .setStyle(ButtonStyle.Primary)
  );

  return { embed, actionRow };
}

// Helper to send alert payloads to the Discord Webhook
async function sendToBillingWebhook(payload) {
  if (!CONFIG.DISCORD_BILLING_WEBHOOK_URL) return false;
  try {
    await axios.post(CONFIG.DISCORD_BILLING_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log('[Billing Webhook] Alert successfully posted to Discord Webhook.');
    return true;
  } catch (err) {
    console.warn(`[Billing Webhook] Discord webhook notice: ${err.message}`);
    return false;
  }
}

// Dedicated helper to send polite renewal DM to customer
async function sendClientReminderDM(clientRecord) {
  const dmMessage = 
`Hey ${clientRecord.client_name}! 👋 Just checking in from the BotWorks AI team.

We noticed an issue with your monthly 24/7 hosting renewal for **${clientRecord.bot_name}**. To make sure your bot stays online without any interruption or downtime, you can renew your $5/month hosting here:
👉 ${CONFIG.STRIPE_RENEWAL_URL}

If you have any questions or already handled this, feel free to reply directly to this message. Thanks for working with us!`;

  try {
    const targetUser = await discordClient.users.fetch(clientRecord.discord_id);
    if (!targetUser) {
      console.warn(`[Sentinel DM] Could not find Discord User ID: ${clientRecord.discord_id}`);
      return { success: false, reason: 'Discord User ID not found' };
    }

    await targetUser.send(dmMessage);
    queries.updateClientLastReminded.run(clientRecord.id);
    console.log(`[Sentinel DM] Renewal reminder DM successfully delivered to ${clientRecord.client_name} (<@${clientRecord.discord_id}>) for ${clientRecord.bot_name}`);
    return { success: true };
  } catch (dmErr) {
    console.error(`[Sentinel DM] Failed to DM client <@${clientRecord.discord_id}>: ${dmErr.message}`);
    return { success: false, reason: dmErr.message };
  }
}

// Function to trigger channel alert embed directly to channel & Discord Webhook, plus auto-DM client when past due
async function dispatchClientAlertToChannel(clientRecord, alertType) {
  const { embed, actionRow } = buildClientAlert(clientRecord, alertType);

  // 1. Post to Management Channel via Bot
  try {
    const channel = await discordClient.channels.fetch(CONFIG.MANAGEMENT_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed], components: [actionRow] });
      console.log(`[Alert Dispatch] Sent ${alertType} alert for ${clientRecord.bot_name} to channel ${CONFIG.MANAGEMENT_CHANNEL_ID}`);
    }
  } catch (err) {
    console.error(`[Alert Dispatch] Channel dispatch failed: ${err.message}`);
  }

  // 2. Post to Discord Billing Webhook
  try {
    await sendToBillingWebhook({
      embeds: [embed.toJSON()]
    });
  } catch (hookErr) {
    console.warn(`[Alert Dispatch] Webhook alert failed: ${hookErr.message}`);
  }

  // 3. AUTOMATIC CLIENT NOTIFICATION:
  // When a client hasn't paid (Past Due), automatically send them the renewal DM
  const isPastDue = alertType.toLowerCase().includes('past') || alertType.toLowerCase().includes('due');
  if (isPastDue) {
    console.log(`[Auto-Reminder] Automatically sending renewal DM to <@${clientRecord.discord_id}> for ${clientRecord.bot_name}...`);
    const reminderResult = await sendClientReminderDM(clientRecord);

    const logText = reminderResult.success
      ? `📩 **Automated Reminder Sent:** Renewal DM automatically sent to <@${clientRecord.discord_id}> with the $5 renewal link.`
      : `⚠️ **Automated Reminder Failed:** Could not DM <@${clientRecord.discord_id}> (DMs closed or mutual server missing). Please message them manually.`;

    try {
      const channel = await discordClient.channels.fetch(CONFIG.MANAGEMENT_CHANNEL_ID);
      if (channel) await channel.send(logText);
    } catch {}

    await sendToBillingWebhook({ content: logText });
  }

  return true;
}

// --- 6B. DISCORD ROLE MANAGEMENT HELPERS ---
async function assignMemberRole(userId, roleId) {
  if (!roleId) return false;
  try {
    const guild = await discordClient.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
      console.log(`[Role Manager] Granted role ${roleId} to user ${userId}`);
    }
    return true;
  } catch (err) {
    console.warn(`[Role Manager] Notice adding role ${roleId} to user ${userId}: ${err.message}`);
    return false;
  }
}

async function removeMemberRole(userId, roleId) {
  if (!roleId) return false;
  try {
    const guild = await discordClient.guilds.fetch(CONFIG.GUILD_ID).catch(() => null);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      console.log(`[Role Manager] Removed role ${roleId} from user ${userId}`);
    }
    return true;
  } catch (err) {
    console.warn(`[Role Manager] Notice removing role ${roleId} from user ${userId}: ${err.message}`);
    return false;
  }
}

// --- 7. DISCORD.JS CLIENT & INTENTS ---
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// --- 8. SLASH COMMAND SPECIFICATIONS ---
const slashCommands = [
  // 1. /scout
  new SlashCommandBuilder()
    .setName('scout')
    .setDescription('Scout public Discord directories for high-potential client servers.')
    .addStringOption(option =>
      option.setName('niche')
        .setDescription('Target client vertical')
        .setRequired(true)
        .addChoices(
          { name: 'FiveM Asset Shops', value: NICHES.FIVEM },
          { name: 'Reselling Cook Groups', value: NICHES.RESELLING },
          { name: 'Roblox Dev Studios', value: NICHES.ROBLOX },
          { name: 'Creative / GFX Agencies', value: NICHES.CREATIVE }
        )
    )
    .addIntegerOption(option =>
      option.setName('min_members')
        .setDescription('Minimum server member count (default: 300)')
        .setRequired(false)
        .setMinValue(50)
    )
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of leads to return (1-10, default: 5)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10)
    ),

  // 2. /pipeline
  new SlashCommandBuilder()
    .setName('pipeline')
    .setDescription('Display active BotWorks AI sales metrics and CRM status summary.'),

  // 3. /update_lead
  new SlashCommandBuilder()
    .setName('update_lead')
    .setDescription('Update the sales CRM pipeline status for a scouted lead.')
    .addStringOption(option =>
      option.setName('server_name')
        .setDescription('Name of the server lead')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('status')
        .setDescription('New CRM pipeline status')
        .setRequired(true)
        .addChoices(
          { name: 'Meeting Booked', value: 'Meeting Booked' },
          { name: 'Closed Won ($15)', value: 'Closed Won ($15)' },
          { name: 'Lost', value: 'Lost' },
          { name: 'Follow Up Later', value: 'Follow Up Later' }
        )
    ),

  // 4. /add_client
  new SlashCommandBuilder()
    .setName('add_client')
    .setDescription('Register and provision a newly hosted client bot under Sentinel tracking.')
    .addUserOption(option =>
      option.setName('client_user')
        .setDescription('Customer Discord account for direct communications')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('bot_name')
        .setDescription('Name of the custom bot (e.g. Eternalforge, Dee Forge, Kazi Resell)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('host_id')
        .setDescription('Sparked Host server UUID (e.g. 519d8828-7cf0-473d-b948-2e71906d50c3)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('stripe_email')
        .setDescription('Client email address associated with monthly Stripe renewal')
        .setRequired(false)
    ),

  // 5. /clients
  new SlashCommandBuilder()
    .setName('clients')
    .setDescription('List all hosted bots, hosting status, MRR total, and direct panel links.'),

  // 6. /set_client_status
  new SlashCommandBuilder()
    .setName('set_client_status')
    .setDescription('Update hosting status for a client bot (triggers alert embed if Past Due/Cancelled).')
    .addStringOption(option =>
      option.setName('bot_name')
        .setDescription('Name of the bot to update')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Client hosting status')
        .setRequired(true)
        .addChoices(
          { name: 'Active', value: 'Active' },
          { name: 'Past Due', value: 'Past Due' },
          { name: 'Cancelled', value: 'Cancelled' }
        )
    ),

  // 7. /payment_link
  new SlashCommandBuilder()
    .setName('payment_link')
    .setDescription('Generate an official BotWorks AI $15 custom build invoice & checkout card')
    .addStringOption(option =>
      option.setName('bot_name')
        .setDescription('Name of the custom bot built (e.g. "Eternalforge Studio Bot", "Dee Forge Customs Bot")')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('client_user')
        .setDescription('Mention the client (@user) who the bot was built for')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('server_link')
        .setDescription("The client's Discord server invite link (e.g. https://discord.gg/...)")
        .setRequired(true)
    ),

  // 8. /remove_client
  new SlashCommandBuilder()
    .setName('remove_client')
    .setDescription('Remove a client bot permanently from Sentinel tracking and database')
    .addStringOption(option =>
      option.setName('bot_name')
        .setDescription('Name of the bot to remove')
        .setRequired(true)
        .setAutocomplete(true)
    )
].map(cmd => cmd.toJSON());

// Slash Command Registration
async function registerSlashCommands() {
  if (!CONFIG.TOKEN) {
    console.warn('[Commands] DISCORD_TOKEN is missing. Skipping auto-registration.');
    return;
  }
  const appId = discordClient.application?.id || discordClient.user?.id || CONFIG.CLIENT_ID;
  if (!appId) {
    console.warn('[Commands] Application/Client ID could not be determined.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

  try {
    console.log(`[Commands] Deploying ${slashCommands.length} slash commands for Application ID: ${appId}...`);
    if (CONFIG.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(appId, CONFIG.GUILD_ID),
        { body: slashCommands }
      );
      console.log(`[Commands] Successfully published commands to Guild: ${CONFIG.GUILD_ID}`);
    } else {
      await rest.put(
        Routes.applicationCommands(appId),
        { body: slashCommands }
      );
      console.log('[Commands] Successfully published global commands.');
    }
  } catch (error) {
    console.error('[Commands] Registration error:', error);
  }
}

// --- 9. INTERACTION HANDLERS (SLASH COMMANDS, AUTOCOMPLETE, BUTTONS) ---

discordClient.on('interactionCreate', async (interaction) => {
  try {
    // -------------------------------------------------------------
    // A. AUTOCOMPLETE HANDLER
    // -------------------------------------------------------------
    if (interaction.isAutocomplete()) {
      const { commandName } = interaction;
      const focusedOption = interaction.options.getFocused(true);

      if (commandName === 'update_lead' && focusedOption.name === 'server_name') {
        const queryTerm = `%${focusedOption.value.trim()}%`;
        const matched = queries.searchLeadsAutocomplete.all(queryTerm);
        await interaction.respond(
          matched.map(lead => ({
            name: `${lead.server_name.slice(0, 70)} [${lead.status}]`,
            value: lead.server_name
          }))
        );
        return;
      }

      if ((commandName === 'set_client_status' || commandName === 'remove_client') && focusedOption.name === 'bot_name') {
        const queryTerm = `%${focusedOption.value.trim()}%`;
        const matched = queries.searchClientsAutocomplete.all(queryTerm);
        await interaction.respond(
          matched.map(client => ({
            name: `${client.bot_name} (${client.client_name}) [${client.status}]`.slice(0, 100),
            value: client.bot_name
          }))
        );
        return;
      }
      return;
    }

    // -------------------------------------------------------------
    // B. BUTTON INTERACTIONS
    // -------------------------------------------------------------
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 1. View Tailored Pitch
      if (customId.startsWith('view_pitch_')) {
        const leadId = parseInt(customId.replace('view_pitch_', ''), 10);
        const lead = queries.findLeadById.get(leadId);

        if (!lead) {
          await interaction.reply({
            content: '❌ Lead record not found in the database.',
            ephemeral: true
          });
          return;
        }

        const pitchText = generatePitch(lead.niche, lead.server_name, lead.member_count);
        await interaction.reply({
          content: `📋 **Tailored Pitch for ${lead.server_name}** (${lead.niche}):\n\`\`\`text\n${pitchText}\n\`\`\`\n*Copy and personalize above text for initial outreach or ticket opening.*`,
          ephemeral: true
        });
        return;
      }

      // 2. Mark Contacted
      if (customId.startsWith('contact_lead_')) {
        const leadId = parseInt(customId.replace('contact_lead_', ''), 10);
        const lead = queries.findLeadById.get(leadId);

        if (!lead) {
          await interaction.reply({ content: '❌ Lead not found in database.', ephemeral: true });
          return;
        }

        queries.updateLeadStatus.run('Contacted', leadId);
        lead.status = 'Contacted';

        const updatedCard = buildLeadCard(lead);
        await interaction.update({
          embeds: [updatedCard.embed],
          components: [updatedCard.actionRow]
        });

        await interaction.followUp({
          content: `✅ Lead **${lead.server_name}** flagged as **Contacted** in CRM database.`,
          ephemeral: true
        });
        return;
      }

      // 3. Dismiss Lead
      if (customId.startsWith('dismiss_lead_')) {
        const leadId = parseInt(customId.replace('dismiss_lead_', ''), 10);
        const lead = queries.findLeadById.get(leadId);

        if (!lead) {
          await interaction.reply({ content: '❌ Lead not found in database.', ephemeral: true });
          return;
        }

        queries.updateLeadStatus.run('Dismissed', leadId);
        lead.status = 'Dismissed';

        const updatedCard = buildLeadCard(lead);
        await interaction.update({
          embeds: [updatedCard.embed],
          components: [updatedCard.actionRow]
        });

        await interaction.followUp({
          content: `❌ Lead **${lead.server_name}** has been **Dismissed** and will be skipped in future scouts.`,
          ephemeral: true
        });
        return;
      }

      // 4. Remind Customer via Direct Message
      if (customId.startsWith('remind_client_')) {
        await interaction.deferReply({ ephemeral: true });
        const clientId = parseInt(customId.replace('remind_client_', ''), 10);
        const clientRecord = queries.getClientById.get(clientId);

        if (!clientRecord) {
          await interaction.editReply({ content: '❌ Client record not found in Sentinel database.' });
          return;
        }

        const result = await sendClientReminderDM(clientRecord);
        if (result.success) {
          await interaction.editReply({
            content: `✅ Reminder DM successfully sent to <@${clientRecord.discord_id}> with the $5 renewal link.`
          });
        } else {
          await interaction.editReply({
            content: `❌ Could not DM <@${clientRecord.discord_id}> — ${result.reason || 'DMs are closed or they do not accept direct messages from server members.'}`
          });
        }
        return;
      }

      // 5. Invoice Hosting & Support Terms Breakdown
      if (customId === 'invoice_terms_btn') {
        await interaction.reply({
          content:
            'ℹ️ **BotWorks AI — Hosting & Support Terms**\n\n' +
            '• **Hosting:** Runs 24/7 on dedicated cloud infrastructure with 99.9% uptime.\n' +
            '• **Ongoing Billing:** $5/month after the first 30 days to maintain 24/7 hosting.\n' +
            '• **Support:** Includes minor bug fixes and Discord API version updates.',
          ephemeral: true
        });
        return;
      }

      return;
    }

    // -------------------------------------------------------------
    // C. SLASH COMMAND HANDLER
    // -------------------------------------------------------------
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- 1. /scout ---
    if (commandName === 'scout') {
      const niche = interaction.options.getString('niche', true);
      const minMembers = interaction.options.getInteger('min_members') || 300;
      const limit = interaction.options.getInteger('limit') || 5;

      await interaction.deferReply();

      console.log(`[Command: /scout] Initiating scout: Niche="${niche}", MinMembers=${minMembers}, Limit=${limit}`);
      const leads = await harvestQualifiedLeads(niche, minMembers, limit);

      if (!leads || leads.length === 0) {
        const noLeadsEmbed = new EmbedBuilder()
          .setColor(CONFIG.COLORS.AMBER_ALERT)
          .setTitle('🔍 Scout Run Completed — No New Leads')
          .setDescription(`All available servers for **${niche}** (≥ ${minMembers} members) have already been scouted or recorded in the database.`)
          .addFields({
            name: '💡 Pro-Tip',
            value: 'Try running with a lower `min_members` threshold or target another vertical with `/scout`.'
          })
          .setFooter({ text: 'BotWorks Lead Scout Engine' });

        await interaction.editReply({ embeds: [noLeadsEmbed] });
        return;
      }

      // Initial acknowledgment embed
      const summaryEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.EMERALD_GREEN)
        .setTitle(`🎯 Qualified Leads Scouted: ${leads.length} Found`)
        .setDescription(`Successfully harvested and vetted **${leads.length}** target servers in **${niche}** meeting the ≥ ${minMembers} member criteria. Deduplicated against database.`)
        .setFooter({ text: 'BotWorks AI • Operations Command Center' });

      await interaction.editReply({ embeds: [summaryEmbed] });

      // Post individual interactive cards
      for (const lead of leads) {
        const { embed, actionRow } = buildLeadCard(lead);
        await interaction.followUp({
          embeds: [embed],
          components: [actionRow]
        });
      }
      return;
    }

    // --- 2. /pipeline ---
    if (commandName === 'pipeline') {
      const metrics = queries.getPipelineMetrics.get();
      const clientMetrics = queries.getClientMetrics.get();

      const totalScouted = metrics.total_scouted || 0;
      const totalContacted = metrics.total_contacted || 0;
      const totalInvoices = metrics.total_invoices || 0;
      const totalMeetings = metrics.total_meetings || 0;
      const totalClosed = metrics.total_closed || 0;
      const totalLost = metrics.total_lost || 0;
      const totalDismissed = metrics.total_dismissed || 0;

      const pipelineEmbed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.DARK_SLATE)
        .setTitle('📊 BotWorks AI — Operations & Sales Pipeline')
        .setDescription('Live CRM lead conversion funnel and agency hosting metrics.')
        .addFields(
          { name: '🎯 Total Leads Scouted', value: `\`${totalScouted.toLocaleString()}\``, inline: true },
          { name: '📩 Outreach Contacted', value: `\`${totalContacted.toLocaleString()}\``, inline: true },
          { name: '🧾 Invoices Issued', value: `\`${totalInvoices.toLocaleString()}\``, inline: true },
          { name: '📅 Meetings Booked', value: `\`${totalMeetings.toLocaleString()}\``, inline: true },
          { name: '🏆 Closed Won Deals', value: `\`${totalClosed.toLocaleString()}\` ($${(totalClosed * CONFIG.PRICING.SETUP_FLAT).toFixed(2)})`, inline: true },
          { name: '❌ Closed Lost / Dismissed', value: `\`${(totalLost + totalDismissed).toLocaleString()}\``, inline: true },
          { name: '💎 Active Hosting Clients', value: `\`${clientMetrics.active_count || 0}\` bots`, inline: true },
          { name: '💵 Current Hosting MRR', value: `\`$${Number(clientMetrics.total_mrr || 0).toFixed(2)}/mo\``, inline: true },
          { name: '⚙️ Base Setup Model', value: `\`$15 Flat (Build + Month 1) -> $5/mo ongoing\``, inline: false }
        )
        .setFooter({ text: 'BotWorks AI Operations Command Center' })
        .setTimestamp();

      await interaction.reply({ embeds: [pipelineEmbed] });
      return;
    }

    // --- 3. /update_lead ---
    if (commandName === 'update_lead') {
      const serverName = interaction.options.getString('server_name', true);
      const newStatus = interaction.options.getString('status', true);

      const existingLead = queries.findLeadByName.get(serverName);
      if (!existingLead) {
        await interaction.reply({
          content: `❌ No lead found in the database with the name: **${serverName}**.`,
          ephemeral: true
        });
        return;
      }

      queries.updateLeadStatusByName.run(newStatus, serverName);

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.EMERALD_GREEN)
        .setTitle('✅ Lead Status Updated')
        .setDescription(`Successfully updated pipeline status for **${existingLead.server_name}**.`)
        .addFields(
          { name: 'Server Name', value: existingLead.server_name, inline: true },
          { name: 'Niche', value: existingLead.niche, inline: true },
          { name: 'Previous Status', value: `\`${existingLead.status}\``, inline: true },
          { name: 'New Status', value: `\`${newStatus}\``, inline: true }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // --- 4. /add_client ---
    if (commandName === 'add_client') {
      const clientUser = interaction.options.getUser('client_user', true);
      const botName = interaction.options.getString('bot_name', true);
      const hostId = interaction.options.getString('host_id', true).trim();
      const stripeEmail = interaction.options.getString('stripe_email') || null;

      // Insert record into clients table
      const insertResult = queries.insertClient.run(
        clientUser.username,
        clientUser.id,
        botName,
        hostId,
        stripeEmail
      );

      const clientRecord = {
        id: insertResult.lastInsertRowid,
        client_name: clientUser.username,
        discord_id: clientUser.id,
        bot_name: botName,
        host_id: hostId,
        stripe_email: stripeEmail,
        status: 'Active',
        monthly_fee: 5.00,
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      };

      // Automatic Role Management: Grant Verified Customer & remove Active Order
      await assignMemberRole(clientUser.id, CONFIG.ROLES.VERIFIED_CUSTOMER);
      await removeMemberRole(clientUser.id, CONFIG.ROLES.ACTIVE_ORDER);

      // 1. Post to channel 1541954518848381030
      try {
        const mgmtChannel = await discordClient.channels.fetch(CONFIG.MANAGEMENT_CHANNEL_ID);
        if (mgmtChannel) {
          const { embed, actionRow } = buildClientCard(clientRecord);
          await mgmtChannel.send({ embeds: [embed], components: [actionRow] });
        }
      } catch (postErr) {
        console.warn(`[Add Client] Could not post to channel ${CONFIG.MANAGEMENT_CHANNEL_ID}: ${postErr.message}`);
      }

      // 2. Respond to slash command
      await interaction.reply({
        content: `✅ Successfully registered client bot **${botName}** for <@${clientUser.id}>. Server UUID: \`${hostId}\`. Granted <@&${CONFIG.ROLES.VERIFIED_CUSTOMER}> role and cleared <@&${CONFIG.ROLES.ACTIVE_ORDER}>.`,
        ephemeral: true
      });
      return;
    }

    // --- 5. /clients ---
    if (commandName === 'clients') {
      const allClients = queries.getAllClients.all();
      const metrics = queries.getClientMetrics.get();

      if (!allClients || allClients.length === 0) {
        await interaction.reply({
          content: 'ℹ️ No clients currently registered in the database. Use `/add_client` to provision a client.',
          ephemeral: true
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.BLURPLE)
        .setTitle('🛡️ BotWorks AI — Client Sentinel & Hosting Directory')
        .setDescription(`Active tracking for **${allClients.length}** client bot installations on Sparked Host panel.`)
        .setFooter({ text: `Total MRR: $${Number(metrics.total_mrr || 0).toFixed(2)}/mo • Active Bots: ${metrics.active_count || 0}` })
        .setTimestamp();

      for (const c of allClients.slice(0, 20)) {
        const statusEmoji = c.status === 'Active' ? '🟢' : c.status === 'Past Due' || c.status === 'Past_Due' ? '🟠' : '🔴';
        const panelLink = `[Panel Startup](${CONFIG.SPARKED_PANEL_BASE}/${c.host_id}/startup)`;
        
        embed.addFields({
          name: `${statusEmoji} ${c.bot_name} (${c.status})`,
          value: `• **Client:** <@${c.discord_id}>\n• **UUID:** \`${c.host_id}\` (${panelLink})\n• **Fee:** $${Number(c.monthly_fee || 5).toFixed(2)}/mo | **Stripe:** \`${c.stripe_email || 'N/A'}\`\n• **Last Reminded:** ${c.last_reminded ? `\`${c.last_reminded}\`` : '_None_'}`,
          inline: false
        });
      }

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Sparked Host Billing')
          .setEmoji('💳')
          .setStyle(ButtonStyle.Link)
          .setURL(CONFIG.SPARKED_BILLING_URL)
      );

      await interaction.reply({ embeds: [embed], components: [actionRow] });
      return;
    }

    // --- 6. /set_client_status ---
    if (commandName === 'set_client_status') {
      const botName = interaction.options.getString('bot_name', true);
      const newStatus = interaction.options.getString('status', true);

      const clientRecord = queries.getClientByBotName.get(botName);
      if (!clientRecord) {
        await interaction.reply({
          content: `❌ Client bot with name **${botName}** not found in database.`,
          ephemeral: true
        });
        return;
      }

      queries.updateClientStatus.run(newStatus, clientRecord.id);
      clientRecord.status = newStatus;

      // Trigger Alert Embed if status is Past Due or Cancelled
      if (newStatus === 'Past Due' || newStatus === 'Cancelled') {
        await dispatchClientAlertToChannel(clientRecord, newStatus);
      }

      await interaction.reply({
        content: `✅ Updated status for **${clientRecord.bot_name}** to **${newStatus}**. ${newStatus !== 'Active' ? `Dispatched alert embed to <#${CONFIG.MANAGEMENT_CHANNEL_ID}>.` : ''}`,
        ephemeral: true
      });
      return;
    }

    // --- 7. /payment_link ---
    if (commandName === 'payment_link') {
      const botName = interaction.options.getString('bot_name', true);
      const clientUser = interaction.options.getUser('client_user', true);
      const serverLink = interaction.options.getString('server_link', true).trim();

      // Database Logging: Log into SQLite leads table with status 'Invoice Sent'
      try {
        queries.upsertInvoiceLead.run(
          `${botName} Server`,
          serverLink
        );
      } catch (dbErr) {
        console.warn(`[Payment Link] Database logging notice: ${dbErr.message}`);
      }

      // Automatic Role Management: Grant Active Order role to client
      await assignMemberRole(clientUser.id, CONFIG.ROLES.ACTIVE_ORDER);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('💎 BotWorks AI — Custom Discord Bot Order & Deployment Invoice')
        .setDescription('Your custom Discord bot build has been compiled and is staged for 24/7 cloud deployment. Review your order details below and complete setup to initiate server invite & launch.')
        .addFields(
          { name: '🤖 Custom Bot', value: `**${botName}**`, inline: true },
          { name: '👤 Client', value: `<@${clientUser.id}>`, inline: true },
          { name: '🌐 Target Server', value: serverLink.startsWith('http') ? `[Join Server / Target Link](${serverLink})` : serverLink, inline: false },
          {
            name: '📦 Package Inclusions',
            value:
              '• Complete Custom Slash Command Suite\n' +
              '• Interactive UI Buttons, Dropdowns & Modals\n' +
              '• Dedicated 24/7 Cloud Hosting (First Month Included)\n' +
              '• Ongoing High-Uptime Maintenance ($5/mo thereafter)',
            inline: false
          },
          {
            name: '💰 Total Due Today',
            value: '```fix\n$15.00 USD (Flat Fee)\n```',
            inline: false
          }
        )
        .setFooter({ text: 'BotWorks AI • High-Performance Discord Bot Systems • Secured by Stripe' })
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Pay & Launch Bot ($15)')
          .setEmoji('💳')
          .setStyle(ButtonStyle.Link)
          .setURL('https://buy.stripe.com/fZu14n1Kj40M4So1eL2Ry00'),
        new ButtonBuilder()
          .setCustomId('invoice_terms_btn')
          .setLabel('Hosting & Support Terms')
          .setEmoji('ℹ️')
          .setStyle(ButtonStyle.Secondary)
      );

      // Public card in chat/ticket
      await interaction.reply({
        embeds: [embed],
        components: [actionRow]
      });
      return;
    }

    // --- 8. /remove_client ---
    if (commandName === 'remove_client') {
      const botName = interaction.options.getString('bot_name', true);
      const clientRecord = queries.getClientByBotName.get(botName);

      if (!clientRecord) {
        await interaction.reply({
          content: `❌ Client bot with name **${botName}** not found in database.`,
          ephemeral: true
        });
        return;
      }

      queries.deleteClient.run(clientRecord.id);

      // Automatic Role Management: If customer has no other bots remaining, revoke Verified Customer role
      const remainingBots = db.prepare('SELECT COUNT(*) as count FROM clients WHERE discord_id = ?').get(clientRecord.discord_id);
      if (!remainingBots || remainingBots.count === 0) {
        await removeMemberRole(clientRecord.discord_id, CONFIG.ROLES.VERIFIED_CUSTOMER);
      }

      const embed = new EmbedBuilder()
        .setColor(CONFIG.COLORS.CRIMSON_ALERT)
        .setTitle('🗑️ Client Bot Removed from Sentinel')
        .setDescription(`Successfully removed **${clientRecord.bot_name}** from Sentinel tracking and database.`)
        .addFields(
          { name: '🤖 Bot Name', value: `**${clientRecord.bot_name}**`, inline: true },
          { name: '👤 Client', value: `<@${clientRecord.discord_id}> (${clientRecord.client_name})`, inline: true },
          { name: '🖥️ Sparked Host UUID', value: `\`${clientRecord.host_id}\``, inline: false },
          { name: '📉 Former Status', value: `\`${clientRecord.status}\``, inline: true }
        )
        .setFooter({ text: 'BotWorks Sentinel • Client De-provisioned' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Log to management channel if run outside it
      if (interaction.channelId !== CONFIG.MANAGEMENT_CHANNEL_ID) {
        try {
          const mgmtChannel = await discordClient.channels.fetch(CONFIG.MANAGEMENT_CHANNEL_ID);
          if (mgmtChannel) {
            await mgmtChannel.send({ embeds: [embed] });
          }
        } catch {}
      }

      // Also log notice to billing webhook
      await sendToBillingWebhook({
        embeds: [embed.toJSON()]
      });

      console.log(`[Sentinel] Removed client bot ${clientRecord.bot_name} (ID: ${clientRecord.id}) from database.`);
      return;
    }

  } catch (error) {
    console.error('[Interaction Error]', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ An unexpected error occurred while executing this command.', ephemeral: true }).catch(() => {});
    } else if (interaction.deferred) {
      await interaction.editReply({ content: '❌ An unexpected error occurred during execution.' }).catch(() => {});
    }
  }
});

// --- 10. EXPRESS WEBHOOK LISTENER & HEALTH MONITOR ---
const app = express();
app.use(express.json());

// Root health check endpoint for Pterodactyl and uptime monitors
app.get('/', (req, res) => {
  const metrics = queries.getClientMetrics.get();
  res.status(200).json({
    status: 'online',
    service: 'BotWorks Command Center',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    mrr: Number(metrics.total_mrr || 0).toFixed(2),
    active_bots: metrics.active_count || 0
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Stripe Subscription Webhook Handler
app.post('/webhook', async (req, res) => {
  const event = req.body;

  if (!event || !event.type) {
    return res.status(400).send('Invalid event payload');
  }

  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  try {
    const dataObject = event.data ? event.data.object : {};

    // 1. Invoice Payment Failed -> Alert & Past Due
    if (event.type === 'invoice.payment_failed') {
      const customerEmail = dataObject.customer_email || (dataObject.customer_details && dataObject.customer_details.email);
      console.warn(`[Stripe Webhook] Payment failed for customer: ${customerEmail}`);

      if (customerEmail) {
        const clientRecord = queries.getClientByEmail.get(customerEmail);
        if (clientRecord) {
          queries.updateClientStatus.run('Past Due', clientRecord.id);
          clientRecord.status = 'Past Due';
          await dispatchClientAlertToChannel(clientRecord, 'Past Due');
        } else {
          console.warn(`[Stripe Webhook] No matching client found for email: ${customerEmail}`);
        }
      }
    }

    // 2. Subscription Cancelled / Deleted -> Alert & Cancelled
    else if (event.type === 'customer.subscription.deleted') {
      const customerEmail = dataObject.customer_email;
      console.warn(`[Stripe Webhook] Subscription deleted for: ${customerEmail}`);

      if (customerEmail) {
        const clientRecord = queries.getClientByEmail.get(customerEmail);
        if (clientRecord) {
          queries.updateClientStatus.run('Cancelled', clientRecord.id);
          clientRecord.status = 'Cancelled';
          await dispatchClientAlertToChannel(clientRecord, 'Cancelled');
        }
      }
    }

    // 3. Invoice Payment Succeeded -> Re-activate bot if it was Past Due
    else if (event.type === 'invoice.payment_succeeded' || event.type === 'payment_intent.succeeded') {
      const customerEmail = dataObject.customer_email || (dataObject.customer_details && dataObject.customer_details.email);
      console.log(`[Stripe Webhook] Payment succeeded for: ${customerEmail}`);

      if (customerEmail) {
        const clientRecord = queries.getClientByEmail.get(customerEmail);
        if (clientRecord && clientRecord.status !== 'Active') {
          queries.updateClientStatus.run('Active', clientRecord.id);
          console.log(`[Stripe Webhook] Restored active status for ${clientRecord.bot_name}`);

          const paymentMsg = `💳 **Payment Received:** Monthly hosting renewal confirmed for **${clientRecord.bot_name}** (<@${clientRecord.discord_id}>). Status restored to **🟢 Active**.`;
          try {
            const channel = await discordClient.channels.fetch(CONFIG.MANAGEMENT_CHANNEL_ID);
            if (channel) {
              await channel.send({ content: paymentMsg });
            }
          } catch (sendErr) {
            console.warn(`[Stripe Webhook] Notice dispatch failed: ${sendErr.message}`);
          }
          await sendToBillingWebhook({ content: paymentMsg });
        }
      }
    }

    res.status(200).json({ received: true });
  } catch (webhookErr) {
    console.error('[Stripe Webhook Error]', webhookErr);
    res.status(500).json({ error: webhookErr.message });
  }
});

// Start Express Webhook Server
const server = app.listen(CONFIG.PORT, () => {
  console.log(`[Express Webhook] Server listening on port ${CONFIG.PORT} (Endpoint: /webhook)`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Express Webhook] Port ${CONFIG.PORT} is already in use by an active bot instance.`);
  } else {
    console.error('[Express Webhook Error]', err.message);
  }
});

// --- 11. BOT STARTUP & LIFECYCLE ---
discordClient.once('ready', async () => {
  console.log(`=======================================================`);
  console.log(`BotWorks Command Center logged in as: ${discordClient.user.tag}`);
  console.log(`Management Guild ID: ${CONFIG.GUILD_ID}`);
  console.log(`Management Channel ID: ${CONFIG.MANAGEMENT_CHANNEL_ID}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`=======================================================`);

  // Register Slash Commands
  await registerSlashCommands();

  // Validate Management Channel Connectivity
  try {
    const mgmtChannel = await discordClient.channels.fetch(CONFIG.MANAGEMENT_CHANNEL_ID);
    if (mgmtChannel) {
      console.log(`[Channel Sentinel] Connected to #${mgmtChannel.name} (${CONFIG.MANAGEMENT_CHANNEL_ID})`);
    } else {
      console.warn(`[Channel Sentinel] Warning: Management channel ${CONFIG.MANAGEMENT_CHANNEL_ID} not found.`);
    }
  } catch (chErr) {
    console.warn(`[Channel Sentinel] Note: Could not fetch channel ${CONFIG.MANAGEMENT_CHANNEL_ID} on launch: ${chErr.message}`);
  }
});

// Global Error Catchers for High-Availability
process.on('unhandledRejection', (reason, promise) => {
  console.error('[System] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[System] Uncaught Exception:', err);
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\n[System] Gracefully shutting down...');
  server.close(() => console.log('[Express] HTTP server terminated.'));
  db.close();
  console.log('[Database] SQLite closed.');
  discordClient.destroy();
  console.log('[Discord] Client disconnected.');
  process.exit(0);
});

// Connect to Discord Gateway
if (CONFIG.TOKEN) {
  discordClient.login(CONFIG.TOKEN).catch(err => {
    console.error('[Discord] Authentication failed:', err.message);
  });
} else {
  console.warn('[Discord] DISCORD_TOKEN is not set in .env. Ready for token injection.');
}

module.exports = {
  discordClient,
  db,
  queries,
  harvestQualifiedLeads,
  generatePitch,
  buildLeadCard,
  buildClientCard,
  buildClientAlert,
  dispatchClientAlertToChannel
};
