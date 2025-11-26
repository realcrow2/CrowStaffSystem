import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const commands = [
new SlashCommandBuilder()
    .setName("evaluate")
    .setDescription("View evaluation status for a user")
        .addUserOption(option =>
            option.setName("user").setDescription("Select a user")
        ),

    new SlashCommandBuilder()
        .setName("promotions")
        .setDescription("List staff eligible for promotion (based on config)"),

    new SlashCommandBuilder()
        .setName("staffnextweek")
        .setDescription("Advance staff week tracking to next week (Admin only)")
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log("🧹 Clearing old commands...");
        // Clear global commands
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: [] }
        );
        // Clear guild commands if GUILD_ID is set
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: [] }
            );
        }
        console.log("✅ Old commands cleared");

        console.log("📦 Registering new commands...");
        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
            console.log("✅ Guild commands registered");
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            console.log("✅ Global commands registered");
        }
    } catch (e) {
        console.error(e);
    }
})();