import {
  AttachmentBuilder, Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, Events, MessageFlags
} from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const apiUrl = (process.env.VANTA_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const botApiKey = process.env.VANTA_BOT_API_KEY;

if (!token || !clientId) throw new Error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID in your environment.");

const commands = [
  new SlashCommandBuilder().setName("help").setDescription("Show Vanta Obfuscator commands."),
  new SlashCommandBuilder().setName("status").setDescription("Check Vanta API and engine status."),
  new SlashCommandBuilder().setName("profile").setDescription("Check your linked Vanta account."),
  new SlashCommandBuilder().setName("stats").setDescription("Show Vanta platform statistics (server administrators only)."),
  new SlashCommandBuilder()
    .setName("obfuscate")
    .setDescription("Obfuscate Luau source you own or are authorized to protect.")
    .addStringOption(option => option.setName("source").setDescription("Luau source code (up to 4,000 characters)").setRequired(true).setMaxLength(4000))
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);
if (guildId) await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
else await rest.put(Routes.applicationCommands(clientId), { body: commands });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, readyClient => console.log(`Vanta bot online as ${readyClient.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "help") {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: [
        "**Vanta Obfuscator**",
        "`/status` — check API status",
        "`/obfuscate source` — build a Luau snippet",
        "`/profile` — check your linked Vanta account",
        "`/stats` — platform statistics (server administrators)",
        "`/help` — show this message",
        "\nObfuscate uses the single Vanta Luau pipeline with official syntax validation."
      ].join("\n") });
      return;
    }

    if (interaction.commandName === "status") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
      const health = await response.json() as { service?: string; version?: string; engine?: string };
      await interaction.editReply(`Vanta API: online\nService: ${health.service ?? "unknown"}\nVersion: ${health.version ?? "unknown"}\nEngine: ${health.engine ?? "unknown"}`);
      return;
    }

    if (interaction.commandName === "profile") {
      if (!botApiKey) throw new Error("The bot profile integration is not configured yet.");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const response = await fetch(`${apiUrl}/api/admin/discord/${interaction.user.id}`, { headers: { Authorization: `Bearer ${botApiKey}` }, signal: AbortSignal.timeout(5000) });
      const data = await response.json() as { user?: { display_name?: string; role?: string } ; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error ?? "No Vanta account is linked. Link Discord from your Vanta dashboard first.");
      await interaction.editReply(`Linked Vanta account: **${data.user.display_name ?? "Vanta user"}**\nRole: **${data.user.role ?? "user"}**`);
      return;
    }

    if (interaction.commandName === "stats") {
      if (!interaction.memberPermissions?.has("Administrator")) throw new Error("Server administrator permission is required.");
      if (!botApiKey) throw new Error("The bot statistics integration is not configured yet.");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const response = await fetch(`${apiUrl}/api/admin/stats`, { headers: { Authorization: `Bearer ${botApiKey}` }, signal: AbortSignal.timeout(5000) });
      const data = await response.json() as { users?: number; builds?: number; activeApiKeys?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load Vanta statistics.");
      await interaction.editReply(`**Vanta statistics**\nUsers: ${data.users ?? 0}\nBuilds: ${data.builds ?? 0}\nActive API keys: ${data.activeApiKeys ?? 0}`);
      return;
    }

    if (interaction.commandName === "obfuscate") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const source = interaction.options.getString("source", true);
      const response = await fetch(`${apiUrl}/api/builds`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, target: "luau" }), signal: AbortSignal.timeout(15000)
      });
      const accepted = await response.json() as { buildId?: string; status?: string; message?: string; error?: string };
      if (!response.ok || !accepted.buildId) throw new Error(accepted.message ?? accepted.error ?? `Build failed (${response.status})`);
      let status = accepted.status ?? "queued";
      let statusMessage = "";
      for (let attempt = 0; attempt < 90 && status !== "completed" && status !== "failed"; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const poll = await fetch(`${apiUrl}/api/builds/${accepted.buildId}/status`, { signal: AbortSignal.timeout(5000) });
        const state = await poll.json() as { status?: string; message?: string };
        if (!poll.ok) throw new Error(state.message ?? `Build status check failed (${poll.status})`);
        status = state.status ?? "failed";
        statusMessage = state.message ?? "";
      }
      if (status !== "completed") throw new Error(statusMessage || (status === "failed" ? "Build failed." : "Build timed out."));
      const outputResponse = await fetch(`${apiUrl}/api/builds/${accepted.buildId}`, { signal: AbortSignal.timeout(5000) });
      const outputData = await outputResponse.json() as { build?: { output?: string; warnings?: string[] }; error?: string };
      if (!outputResponse.ok || !outputData.build?.output) throw new Error(outputData.error ?? "Build output could not be retrieved.");
      const output = outputData.build.output;
      const warnings = outputData.build.warnings ?? [];
      if (output.length > 1800) {
        await interaction.editReply({ content: `Build completed. Full output is attached as a Luau file.`, files: [new AttachmentBuilder(Buffer.from(output, "utf8"), { name: "vanta-output.luau" })] });
      } else {
        await interaction.editReply({ content: `**Build completed**\n\n\`\`\`lua\n${output}\n\`\`\`\n${warnings.join("\n")}`.slice(0, 1950) });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (interaction.deferred || interaction.replied) await interaction.editReply(`Vanta error: ${message.slice(0, 1500)}`).catch(() => undefined);
    else await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Vanta error: ${message.slice(0, 1500)}` }).catch(() => undefined);
  }
});

await client.login(token);
