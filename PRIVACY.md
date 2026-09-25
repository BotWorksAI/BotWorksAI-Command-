# BotWorks Command — Privacy Policy

**Effective date:** September 25, 2026  
**Operator:** BotWorks AI (“we”, “us”)  
**App:** BotWorks Command (the “Bot”)

This policy describes what Discord-related data the Bot processes and why. It is meant to satisfy Discord’s requirement that verified apps publish a privacy policy.

## 1. Who this covers
This applies to people who use the Bot (commands, buttons, messages the Bot is configured to read) and to server owners who install it.

## 2. Data we process
Depending on how the Bot is configured in a server, we may process:

**From Discord (necessary to run commands)**
- Discord user ID, username/display name, and avatar URL of the person who uses a command
- Guild (server) ID, channel ID, and role IDs needed for permissions
- Command names, options, and the text you submit to the Bot
- Message content only if a feature requires it and the Bot has been granted that access
- Interaction tokens needed to reply

**Operational data we may store**
- Server configuration (enabled features, prefix/settings, allowed channels)
- Command usage logs (timestamp, command name, guild ID, user ID) for abuse prevention and debugging
- Optional memory or conversation context if an AI feature is enabled for that server

We do **not** require your email, phone number, government ID, or payment card to use the Bot. Discord handles those separately.

## 3. Why we process it
- Provide the command or AI response you requested
- Remember server settings
- Detect abuse, spam, and security incidents
- Debug outages
- Comply with Discord’s Developer Terms and the law

Legal bases where GDPR applies: performance of a contract (providing the Bot you installed) and legitimate interests (security, abuse prevention, reliability).

## 4. AI providers
If you use AI features, the prompt and necessary context (command text, and sometimes recent channel or memory context) are sent to a language-model provider so a reply can be generated. Those providers process the prompt under their own terms. Do not submit secrets, passwords, or other people’s private data into AI commands.

## 5. What we do not do
- We do not sell personal data
- We do not use Bot data to advertise to you
- We do not use your prompts to train a public model unless we clearly say so in-product and you opt in
- We do not scrape a server’s full message history unless a documented feature requires it and a server admin enabled that feature

## 6. Sharing
We share data only with:
- Discord, as required to operate an app on their platform
- Hosting, logging, and AI vendors that process data on our instructions
- Authorities if legally required

## 7. Retention
- Command/interaction payloads needed only to reply are kept transiently
- Server settings are kept until the Bot is removed or the setting is deleted
- Abuse and security logs are kept only as long as needed (typically up to 90 days, longer if an investigation is open)
- If you kick/remove the Bot, we will delete or anonymize stored guild configuration within a reasonable period, except data we must keep for security or legal reasons

## 8. Your choices
- Don’t use a command if you don’t want that input processed
- Server admins can restrict the Bot to certain channels or remove it
- You can ask us to delete stored data tied to your Discord user ID or a guild ID

To request deletion or access, open an issue on this repository and include the relevant Discord user ID and/or server ID (not tokens or passwords).

## 9. Children
The Bot is not directed at children under 13 (or the minimum age Discord requires in your country). Server admins should not use the Bot to collect information from children.

## 10. Security
We use standard access controls for bot tokens and stored settings. No method of transmission is perfectly secure.

## 11. International transfers
Vendors may process data in the United States or other countries. If you use the Bot, you understand that transfer.

## 12. Changes
We will update the effective date when this policy changes.

## 13. Contact
GitHub: https://github.com/BotWorksAI  
Repository issues on the BotWorks Command project.
