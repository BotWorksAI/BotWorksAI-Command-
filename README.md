# ⚡ BotWorks Command Center

> **Autonomous All-in-One Internal Operations Bot for BotWorks AI**  
> Engineered with Node.js 20, Discord.js v14, SQLite (`better-sqlite3`), and Express. Designed specifically for deployment on Pterodactyl / Sparked Host panel.

---

## 🧭 Executive Summary

**BotWorks Command Center** is the centralized mission control bot for **BotWorks AI**. It operates autonomously across two high-impact agency operations:

1. **Lead Scout & Outreach Engine:** Continuously harvests high-value server leads from public Discord directories (Disboard, Discadia, DiscordServers), deduplicates against local SQLite storage, generates tailored 3-point feature pitches ($15 build + $5/mo ongoing hosting), and manages the sales pipeline.
2. **Sparked Host Billing & Client Sentinel:** Monitors active client bot servers hosted on Sparked Host, tracks MRR, delivers instant past-due/cancellation alert embeds to the staff management channel, and features a one-click **Remind Customer** DM engine routing clients directly to the official Stripe renewal link.

---

## 🛠️ Tech Stack & Runtime Environment

- **Runtime:** Node.js 20 LTS (Compatible with Sparked Host / Pterodactyl Panel)
- **Discord Framework:** `discord.js` (v14.17.3)
- **Database Engine:** `better-sqlite3` (High-performance synchronous SQLite with WAL mode)
- **Web & Webhooks:** `express` (v4.21.2)
- **Scraping Engine:** `axios` (v1.7.9) + `cheerio` (v1.0.0) with rotating User-Agents
- **Configuration:** `dotenv` (v16.4.7)

---

## ⚙️ Core Configuration & Constants

| Key | Value / Target | Description |
| :--- | :--- | :--- |
| **Management Channel ID** | `1541954518848381030` | Official BotWorks AI operational command channel |
| **Management Guild ID** | `1540161593290260490` | BotWorks AI internal staff server |
| **Sparked Host Panel** | `https://control.sparkedhost.us/server/{HOST_ID}/startup` | Direct deep-link to server console & startup |
| **Sparked Host Billing** | `https://billing.sparkedhost.com/clientarea.php` | Direct link to client area services |
| **Stripe Renewal Link** | `https://buy.stripe.com/00w00jbkTeFqbgM0aH2Ry01` | Official $5/month recurring hosting link |
| **Verified Customer Role** | `1540161925659238480` | Automatically granted on `/add_client` |
| **Active Order Role** | `1540219844199448636` | Automatically granted on `/payment_link` |
| **Base Pricing Model** | `$15 Flat Setup` (Build + 1st Mo) $\rightarrow$ `$5/mo Hosting` | Core agency pricing cited in all pitches |

---

## 🗄️ Database Architecture (`botworks.db`)

The bot operates on a local SQLite database (`botworks.db`) via `better-sqlite3`, pre-configured in **WAL (Write-Ahead Logging)** mode for zero concurrency lockups:

### 1. `leads` Table
Stores all scouted servers, prevents duplicate pitches, and tracks the sales funnel:
```sql
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_name TEXT NOT NULL,
  invite_url TEXT UNIQUE NOT NULL,
  member_count INTEGER NOT NULL,
  niche TEXT NOT NULL,
  status TEXT DEFAULT 'New', -- 'New', 'Contacted', 'Meeting Booked', 'Closed Won ($15)', 'Lost', 'Dismissed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2. `clients` Table
Tracks client bot installations, Sparked Host server UUIDs, billing contacts, and payment status:
```sql
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_name TEXT NOT NULL,
  discord_id TEXT NOT NULL,       -- Discord User ID for 1-click direct DMs
  bot_name TEXT NOT NULL,         -- e.g. "Eternalforge", "Dee Forge", "Kazi Resell"
  host_id TEXT NOT NULL,          -- Sparked Host UUID e.g. 519d8828-7cf0-473d-b948-2e71906d50c3
  stripe_email TEXT,              -- Client email associated with Stripe subscription
  status TEXT DEFAULT 'Active',   -- 'Active', 'Past Due', 'Cancelled'
  monthly_fee REAL DEFAULT 5.00,  -- $5.00/mo ongoing hosting fee
  last_reminded DATETIME,         -- Timestamp of last automated/manual reminder sent
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🚀 Part 1: Lead Scout & Outreach Engine

### 1. `/scout` Slash Command
Scouts public Discord directories across 4 target verticals:
- **Options:**
  - `niche` (Required): `"FiveM Asset Shops"`, `"Reselling Cook Groups"`, `"Roblox Dev Studios"`, `"Creative / GFX Agencies"`
  - `min_members` (Optional, default: 300): Filters communities below this size
  - `limit` (Optional, default: 5, max: 10): Number of leads to return
- **Interactive Lead Card:**
  - **Color:** Dark Slate (`#1E1F22`)
  - **Title:** `🎯 New Lead: [Server Name] • [Member Count] Members`
  - **Action Row Buttons:**
    - `[ 🚀 Join Server ]` $\rightarrow$ Direct invite link to join target Discord.
    - `[ 📋 View Pitch ]` $\rightarrow$ Ephemeral preview containing tailored 3-point pitch text ready to copy.
    - `[ ✅ Mark Contacted ]` $\rightarrow$ Instantly updates lead status to `Contacted` in SQLite.
    - `[ ❌ Dismiss ]` $\rightarrow$ Flags as `Dismissed` to permanently exclude from future scouts.

### 2. Built-in Dynamic Pitch Engine
Each niche features custom value propositions addressing specific operational bottlenecks:
- **FiveM Asset Shops:** Pitches `/catalog` interactive dropdown for scripts/MLOs, `/order` intake modal to eliminate DM overload, and automated vouch routing.
- **Reselling Cook Groups:** Pitches `/win` profit & ROI flip calculator, `/tiers` perk display, and automated VIP vouch routing.
- **Roblox Dev Studios:** Pitches `/talent` searchable developer directory, `/hire` commission work-order modal, and milestone tracker.
- **Creative Agencies:** Pitches interactive `/portfolio` showcase galleries, `/quote` client intake form, and verified review loggers.
- *All pitches cite:* **$15 flat (build + 1st month hosting included), then $5/mo ongoing hosting.**

### 3. `/pipeline` Slash Command
Provides real-time visibility into the BotWorks sales funnel and hosting MRR:
- Total Leads Scouted
- Outreach Contacted
- Meetings Booked
- Closed Won Deals ($15/deal revenue calculation)
- Lost / Dismissed Count
- Active Hosting Bots & Current Monthly MRR

### 4. `/update_lead` Slash Command
- **Options:** `server_name` (with dynamic autocomplete) + `status` (`Meeting Booked`, `Closed Won ($15)`, `Lost`, `Follow Up Later`).

### 5. `/payment_link` Slash Command (New!)
Generates an official, branded BotWorks AI $15 custom build invoice & checkout card directly in any ticket or chat channel:
- **Options:**
  - `bot_name` (Required): Name of the custom bot built (e.g. "Eternalforge Studio Bot", "Dee Forge Customs Bot")
  - `client_user` (Required): Mention the client (@user) who the bot was built for
  - `server_link` (Required): Client's Discord server invite link (e.g. `https://discord.gg/...`)
- **Card Embed & Interactive Buttons:**
  - **Color:** Discord Blurple (`0x5865F2`)
  - **Inclusions:** Full slash command suite, interactive UI, 24/7 cloud hosting (1st month included), $5/mo ongoing maintenance.
  - **Total Due:** `$15.00 USD (Flat Fee)`
  - `[ 💳 Pay & Launch Bot ($15) ]` $\rightarrow$ Direct checkout link (`https://buy.stripe.com/fZu14n1Kj40M4So1eL2Ry00`)
  - `[ ℹ️ Hosting & Support Terms ]` $\rightarrow$ Ephemeral breakdown of 99.9% uptime, $5/mo renewal, and maintenance terms.
- **Pipeline Logging:** Automatically logs issued invoices into SQLite with status `Invoice Sent`, updating the `/pipeline` counter in real time.

---

## 🛡️ Part 2: Sparked Host Billing & Client Sentinel

### 1. `/add_client` Slash Command
Registers a newly built and deployed client bot:
- **Options:**
  - `client_user` (Discord User mention)
  - `bot_name` (e.g. `Eternalforge`, `Dee Forge`, `Kazi Resell`)
  - `host_id` (Sparked Host UUID, e.g. `519d8828-7cf0-473d-b948-2e71906d50c3`)
  - `stripe_email` (Optional Stripe customer email)
- **Automatic Dispatch:**
  - Inserts client into SQLite `clients` table.
  - Posts an official **Emerald Green (`0x10B981`)** card directly to `#1541954518848381030` with direct buttons to the Sparked Host Control Panel and Billing Area.

### 2. `/clients` Slash Command
Displays a full directory of all hosted bots, client mentions, status badges (`🟢 Active`, `🟠 Past Due`, `🔴 Cancelled`), Sparked Host console links, and calculates total monthly MRR.

### 3. `/set_client_status` Slash Command
- **Options:** `bot_name` (with autocomplete) + `status` (`Active`, `Past Due`, `Cancelled`).
- If set to `Past Due` or `Cancelled`, automatically triggers an Alert Embed in `#1541954518848381030` and automatically DMs the client with the $5 renewal link.

### 4. `/remove_client` Slash Command (New!)
Permanently removes and de-provisions a client bot from Sentinel tracking:
- **Options:** `bot_name` (with live autocomplete search)
- Deletes the client record from SQLite `clients` table so it no longer appears in `/clients` or MRR totals.
- Broadcasts a de-provisioned audit card with the former Sparked Host UUID.

### 5. Alert Embeds & Interactive ActionRow
When a bot is flagged as `Past Due` (Amber `0xF59E0B`) or `Cancelled` (Crimson `0xFF4343`), an alert is broadcast to `#1541954518848381030` equipped with 3 action buttons:
1. `[ 🖥️ Open Server Panel ]` $\rightarrow$ `https://control.sparkedhost.us/server/{host_id}/startup`
2. `[ 💳 Sparked Host Billing ]` $\rightarrow$ `https://billing.sparkedhost.com/clientarea.php`
3. `[ 📩 Remind Customer ]` $\rightarrow$ Interactive custom ID: `remind_client_{id}`

### 5. Interactive "Remind Customer" DM Flow
When Lucas clicks `[ 📩 Remind Customer ]`:
1. Fetches the client's `discord_id` from the database.
2. Dispatches a professional DM to the customer:
   ```text
   Hey {ClientName}! 👋 Just checking in from the BotWorks AI team.

   We noticed an issue with your monthly 24/7 hosting renewal for **{BotName}**. To make sure your bot stays online without any interruption or downtime, you can renew your $5/month hosting here:
   👉 https://buy.stripe.com/00w00jbkTeFqbgM0aH2Ry01

   If you have any questions or already handled this, feel free to reply directly to this message. Thanks for working with us!
   ```
3. Ephemerally confirms in Discord:  
   `✅ Reminder DM successfully sent to <@{discord_id}> with the $5 renewal link.`
4. Handles blocked or closed DMs gracefully with error logging.
5. Updates `last_reminded` in SQLite.

---

## 🌐 Part 3: Express Webhook Listener & Pterodactyl Integration

The bot includes an embedded **Express.js** web server listening on `process.env.PORT || 3000`:

### Endpoints
- `GET /`: Health status and JSON metrics (MRR, active bot count, uptime) for Pterodactyl and status monitors.
- `GET /health`: Fast 200 OK ping endpoint.
- `POST /webhook`: Incoming Stripe webhook receiver.

### Stripe Webhook Automation
When Stripe fires events to your webhook:
- `invoice.payment_failed`: Finds client by email $\rightarrow$ sets status to `Past Due` $\rightarrow$ dispatches Amber alert card to `#1541954518848381030`.
- `customer.subscription.deleted`: Finds client by email $\rightarrow$ sets status to `Cancelled` $\rightarrow$ dispatches Crimson suspension alert card to `#1541954518848381030`.
- `invoice.payment_succeeded`: Restores status to `🟢 Active` $\rightarrow$ posts confirmation note to `#1541954518848381030`.

---

## 💻 Local Quickstart (Windows)

1. **Configure Environment:**
   Open `.env` in this directory and supply your bot credentials:
   ```env
   DISCORD_TOKEN=your_token_here
   CLIENT_ID=your_client_id_here
   GUILD_ID=1540161593290260490
   MANAGEMENT_CHANNEL_ID=1541954518848381030
   PORT=3000
   ```

2. **One-Click Run:**
   Double click `run.bat` or run:
   ```cmd
   .\run.bat
   ```

3. **Run Automated Test Suite:**
   ```bash
   node test_suite.js
   ```

---

## ☁️ Deployment Guide (Sparked Host / Pterodactyl Panel)

1. In your **Sparked Host / Pterodactyl Control Panel**:
   - Ensure the server container egg is set to **Node.js 20**.
   - Set **Main File** to `bot.js`.
2. Upload the project files:
   - `bot.js`
   - `package.json`
   - `.env`
3. In the Panel's **Console / Terminal**, run:
   ```bash
   npm install
   ```
4. Click **Start** on the control panel.
5. In **Network / Allocation**, ensure the assigned port matches your `PORT` variable in `.env` (default: 3000 or the assigned Pterodactyl port).
6. In **Stripe Dashboard $\rightarrow$ Developers $\rightarrow$ Webhooks**:
   - Add endpoint: `http://<your-sparkedhost-ip>:<port>/webhook`
   - Select events:
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`

---

## 🔒 Security & Reliability Highlights

- **SQLite WAL Mode:** Non-blocking concurrent queries during heavy scraping runs.
- **Auto Re-registration:** Slash commands are registered instantly to the target management guild (`1540161593290260490`) upon bot startup.
- **Fail-Safe Curated Seed Pool:** If external directories return temporary rate limits or Cloudflare challenge pages, the engine falls back to curated verified seeds so outreach never stalls.
- **Zero Unhandled Rejections:** Full global crash handling (`unhandledRejection`, `uncaughtException`, `SIGINT`) guarantees high availability on 24/7 cloud hosts.
