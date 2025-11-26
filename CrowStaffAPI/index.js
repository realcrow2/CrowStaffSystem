import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import express from "express";
import sqlite3 from "sqlite3";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: ["CHANNEL"]
});

// Load config.json
const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "config.json"), "utf8")
);

// Database setup
const db = new sqlite3.Database("./staffhours.db");
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS hours (identifier TEXT, discordId TEXT, total INTEGER, week TEXT, PRIMARY KEY(identifier, week))");
    db.run("CREATE TABLE IF NOT EXISTS week_advances (userId TEXT, timestamp INTEGER, week TEXT)");
});

// REST API for FiveM
const app = express();
app.use(express.json());

// Reusable function for sending DMs with proper error handling
async function sendUserDM(discordId, message, actionName = "message") {
    try {
        // First try to get from cache
        let user = client.users.cache.get(discordId);
        
        // If not in cache, try to fetch the user
        if (!user) {
            user = await client.users.fetch(discordId);
        }
        
        if (user) {
            // Handle both string messages and embed objects
            if (typeof message === 'string') {
                await user.send(message);
            } else {
                await user.send(message);
            }
            console.log(`✅ ${actionName} DM sent to ${user.username} (${discordId})`);
            return true;
        } else {
            console.log(`⚠️ Could not find user with Discord ID: ${discordId}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Failed to send ${actionName} DM to user (${discordId}):`, error.message);
        
        // Log specific error types for debugging
        if (error.code === 50007) {
            console.log("   → User has DMs disabled");
        } else if (error.code === 10013) {
            console.log("   → Invalid Discord ID");
        } else if (error.code === 50001) {
            console.log("   → Missing access (user blocked bot or left mutual servers)");
        }
        
        return false;
    }
}

app.post("/clock", async (req, res) => {
    const { action, identifier, discordId, name, timestamp, duration } = req.body;

    if (action === "clockin") {
        console.log(`${name} clocked in`);
        
        // Create advanced clock-in embed
        const clockInEmbed = {
            color: 0x00ff00, // Green
            title: "🟢 Successfully Clocked In",
            description: `Welcome back to your shift, **${name}**!`,
            fields: [
                {
                    name: "📅 Date & Time",
                    value: `<t:${timestamp}:F>`,
                    inline: true
                },
                {
                    name: "⏰ Quick Time",
                    value: `<t:${timestamp}:t>`,
                    inline: true
                },
                {
                    name: "🎯 Status",
                    value: "```\n✓ ON DUTY\n```",
                    inline: false
                }
            ],
            footer: {
                text: "PSRP Staff API • Remember to clock out when you're done!",
                icon_url: "https://cdn.discordapp.com/emojis/1234567890/green-clock.png" // Optional
            },
            timestamp: new Date(timestamp * 1000).toISOString()
        };

        await sendUserDM(discordId, { embeds: [clockInEmbed] }, "clock-in");
        
    } else if (action === "clockout") {
        console.log(`${name} clocked out after ${duration} sec`);
        const weekNum = getWeekNumber(new Date(timestamp * 1000));

        // Calculate session details
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = duration % 60;
        
        // Format duration display
        let durationText = "";
        if (hours > 0) durationText += `${hours}h `;
        if (minutes > 0) durationText += `${minutes}m `;
        if (seconds > 0 || (hours === 0 && minutes === 0)) durationText += `${seconds}s`;
        durationText = durationText.trim();

        // Get weekly total (we'll calculate this and send in the embed)
        db.get("SELECT total FROM hours WHERE identifier = ? AND week = ?", [identifier, weekNum], async (err, row) => {
            let previousTotal = row ? row.total : 0;
            let newTotal = previousTotal + duration;
            
            // Update database
            db.run("INSERT OR REPLACE INTO hours (identifier, discordId, total, week) VALUES (?, ?, ?, ?)", [identifier, discordId, newTotal, weekNum]);
            
            // Calculate weekly progress
            const requiredMinutes = config.promotion?.requiredMinutes || 240;
            const requiredSeconds = requiredMinutes * 60;
            const weeklyHours = Math.floor(newTotal / 3600);
            const weeklyMinutes = Math.floor((newTotal % 3600) / 60);
            const weeklyPercentage = Math.min(Math.floor((newTotal / requiredSeconds) * 100), 100);
            
            // Progress bar
            let progressBar = "";
            const barLength = 10;
            const filledLength = Math.floor((weeklyPercentage / 100) * barLength);
            for (let i = 0; i < barLength; i++) {
                if (i < filledLength) {
                    progressBar += "🟢";
                } else {
                    progressBar += "⚫";
                }
            }

            // Create advanced clock-out embed
            const clockOutEmbed = {
                color: 0xff6b6b, // Red/Orange
                title: "🔴 Successfully Clocked Out",
                description: `Great work during your shift, **${name}**!`,
                fields: [
                    {
                        name: "📅 Clock Out Time",
                        value: `<t:${timestamp}:F>`,
                        inline: true
                    },
                    {
                        name: "⏱️ Session Duration",
                        value: `**${durationText}**`,
                        inline: true
                    },
                    {
                        name: "📊 This Week's Progress",
                        value: `${progressBar}\n**${weeklyHours}h ${weeklyMinutes}m** / **${Math.floor(requiredMinutes/60)}h ${requiredMinutes%60}m** (${weeklyPercentage}%)`,
                        inline: false
                    },
                    {
                        name: "🎯 Status",
                        value: "```\n✗ OFF DUTY\n```",
                        inline: false
                    }
                ],
                footer: {
                    text: `PSRP Staff API • Week ${weekNum}`,
                    icon_url: "https://cdn.discordapp.com/emojis/1234567890/red-clock.png" // Optional
                },
                timestamp: new Date(timestamp * 1000).toISOString()
            };

            // Add achievement field if they hit milestones
            if (weeklyPercentage >= 100) {
                clockOutEmbed.fields.push({
                    name: "🏆 Achievement Unlocked!",
                    value: "**Weekly Goal Completed!** 🎉\nYou've met your weekly hour requirement!",
                    inline: false
                });
                clockOutEmbed.color = 0xffd700; // Gold color
            } else if (weeklyPercentage >= 75) {
                clockOutEmbed.fields.push({
                    name: "⭐ Great Progress!",
                    value: "You're almost at your weekly goal! Keep it up!",
                    inline: false
                });
            } else if (weeklyPercentage >= 50) {
                clockOutEmbed.fields.push({
                    name: "📈 Halfway There!",
                    value: "You're making good progress this week!",
                    inline: false
                });
            }

            await sendUserDM(discordId, { embeds: [clockOutEmbed] }, "clock-out");
        });
    }

    res.json({ status: "ok" });
});

// Voice channel API endpoint for FiveM to get voice channel info
app.get("/voice-channel/:discordId", (req, res) => {
    const discordId = req.params.discordId;
    
    try {
        const guild = client.guilds.cache.first(); // Adjust if you have multiple guilds
        const member = guild?.members.cache.get(discordId);
        const voiceChannel = member?.voice?.channel;
        
        if (voiceChannel) {
            res.json({ voiceChannel: voiceChannel.id, channelName: voiceChannel.name });
        } else {
            res.json({ voiceChannel: null });
        }
    } catch (error) {
        console.error("Error getting voice channel:", error);
        res.json({ voiceChannel: null });
    }
});

// Test endpoint for debugging DMs
app.get("/test-dm/:discordId", async (req, res) => {
    const discordId = req.params.discordId;
    const success = await sendUserDM(discordId, "🧪 Test message from staff bot!", "test");
    res.json({ success, discordId });
});

app.listen(process.env.PORT || 3000, () => console.log(`API listening on port ${process.env.PORT || 3000}`));

// Helper function to get user's staff rank
function getUserStaffRank(member) {
    const rankRoles = config.rankRoles || {};
    for (const [roleId, rankName] of Object.entries(rankRoles)) {
        if (member.roles.cache.has(roleId)) {
            return rankName;
        }
    }
    return "No Staff Rank";
}

// Helper function to format hours display
function formatHours(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}H | ${minutes}M`;
}

// Helper function to get percentage and emoji
function getPercentageDisplay(total, requiredSeconds) {
    const percentage = Math.min(Math.floor((total / requiredSeconds) * 100), 100);
    let emoji = "🔴";
    if (percentage >= 75) emoji = "🟢";
    else if (percentage >= 50) emoji = "🟡";
    else if (percentage >= 25) emoji = "🟠";
    
    return `${emoji} ${percentage}%`;
}

// Register interaction handler
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // /evaluate - Updated evaluation status display with 3x4 grid
    if (interaction.commandName === "evaluate") {
        let user = interaction.options.getUser("user") || interaction.user;
        let member = interaction.guild.members.cache.get(user.id);
        let discordId = user.id;
        let currentWeek = getWeekNumber(new Date());

        // Get staff rank and role ID
        let staffRank = "Unknown";
        let staffRoleId = null;
        
        if (member) {
            const rankRoles = config.rankRoles || {};
            for (const [roleId, rankName] of Object.entries(rankRoles)) {
                if (member.roles.cache.has(roleId)) {
                    staffRank = rankName;
                    staffRoleId = roleId;
                    break;
                }
            }
        }

        // Get required minutes from config and convert to seconds
        const requiredMinutes = config.promotion.requiredMinutes || 240;
        const requiredSeconds = requiredMinutes * 60;

        // Get current week and last 11 weeks of data
        db.all(`
            SELECT week, total FROM hours 
            WHERE discordId = ? 
            ORDER BY week DESC 
            LIMIT 12
        `, [discordId], (err, rows) => {
            if (err) {
                console.error(err);
                return interaction.reply({ content: "⚠️ Database error.", ephemeral: true });
            }

            // Create weeks map
            let weeksData = {};
            rows.forEach(row => {
                weeksData[row.week] = row.total;
            });

            // Calculate combined weeks total
            let combinedTotal = 0;
            for (let i = 0; i < 12; i++) {
                let weekOffset = getWeekWithOffset(new Date(), -i);
                let weekTotal = weeksData[weekOffset] || 0;
                combinedTotal += weekTotal;
            }

            // Build description with role mention
            let description = `Here is the evaluation status for ${user.username}.\n\n`;
            description += `**NOTE:** Week 0 is the current weeks hours.\n\n`;
            description += `**Staff Rank**\n${staffRoleId ? `<@&${staffRoleId}>` : staffRank}\n\n`;

            // Generate 3x4 grid (3 columns, 4 rows)
            let column1 = "";
            let column2 = "";
            let column3 = "";

            for (let i = 0; i < 12; i++) {
                let weekOffset = getWeekWithOffset(new Date(), -i);
                let weekTotal = weeksData[weekOffset] || 0;
                let weekLabel = i === 0 ? "Week 0" : `Week ${i}`;
                
                let weekDisplay = `**${weekLabel}**\n${formatHours(weekTotal)} ${getPercentageDisplay(weekTotal, requiredSeconds)}\n\n`;
                
                // Distribute weeks across 3 columns (4 weeks per column)
                if (i < 4) {
                    column1 += weekDisplay;
                } else if (i < 8) {
                    column2 += weekDisplay;
                } else {
                    column3 += weekDisplay;
                }
            }

            let embed = new EmbedBuilder()
                .setTitle("📊 Evaluation Status")
                .setDescription(description)
                .addFields(
                    { name: "Weeks 0-3", value: column1.trim(), inline: true },
                    { name: "Weeks 4-7", value: column2.trim(), inline: true },
                    { name: "Weeks 8-11", value: column3.trim(), inline: true },
                    { name: "Combined Weeks of hours", value: `${formatHours(combinedTotal)} ${getPercentageDisplay(combinedTotal, requiredSeconds * 12)}`, inline: false }
                )
                .setColor(0x00FF41) // Neon green color
                .setTimestamp()
                .setThumbnail(user.displayAvatarURL());

            interaction.reply({ embeds: [embed] });
        });
    }

    // /staffnextweek - Advance to next week
    if (interaction.commandName === "staffnextweek") {
        const member = interaction.member;

        // Check permissions
        if (!member.roles.cache.some(r => config.staffnextweek.allowedRoles.includes(r.id))) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
        }

        let currentWeek = getWeekNumber(new Date());
        let nextWeek = getWeekWithOffset(new Date(), 1);

        // Shift all existing hours data
        db.serialize(() => {
            // Get all current data
            db.all("SELECT DISTINCT discordId FROM hours", [], (err, users) => {
                if (err) {
                    console.error(err);
                    return interaction.reply({ content: "⚠️ Database error.", ephemeral: true });
                }

                users.forEach(user => {
                    let discordId = user.discordId;
                    
                    // Get all weeks of data for this user (up to 12 weeks)
                    db.all(`
                        SELECT week, total FROM hours 
                        WHERE discordId = ? 
                        ORDER BY week DESC 
                        LIMIT 12
                    `, [discordId], (err, userWeeks) => {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        // Clear old data for this user
                        db.run("DELETE FROM hours WHERE discordId = ?", [discordId], (err) => {
                            if (err) {
                                console.error(err);
                                return;
                            }

                            // Shift weeks: Week 0 becomes Week 1, Week 1 becomes Week 2, etc.
                            userWeeks.forEach((weekData, index) => {
                                let newWeekOffset = index + 1; // Shift by 1 week
                                
                                // Only keep up to week 11 (weeks 0-11, week 12+ gets wiped)
                                if (newWeekOffset <= 11) {
                                    let newWeek = getWeekWithOffset(new Date(), -newWeekOffset);
                                    
                                    db.run(`
                                        INSERT INTO hours (identifier, discordId, total, week) 
                                        SELECT identifier, discordId, total, ? 
                                        FROM (SELECT ? as identifier, ? as discordId, ? as total) 
                                        WHERE NOT EXISTS (
                                            SELECT 1 FROM hours WHERE discordId = ? AND week = ?
                                        )
                                    `, [newWeek, 'unknown', discordId, weekData.total, discordId, newWeek]);
                                }
                            });
                        });
                    });
                });
            });
        });

        // Log the command usage
        db.run("INSERT INTO week_advances (userId, timestamp, week) VALUES (?, ?, ?)", 
            [interaction.user.id, Math.floor(Date.now() / 1000), nextWeek]);

        // Send webhook log if configured
        if (config.webhookUrl) {
            const webhookEmbed = {
                title: "📅 Week Advanced",
                description: `**${interaction.user.username}** advanced the staff week tracking.\n\nAll staff hours have been shifted:\n• Week 0 → Week 1\n• Week 1 → Week 2\n• etc.\n• Week 12+ wiped`,
                color: 3447003, // blue
                fields: [
                    { name: "Previous Week", value: currentWeek, inline: true },
                    { name: "New Week", value: nextWeek, inline: true },
                ],
                footer: {
                    text: `Staff System • ${new Date().toISOString()}`,
                },
                timestamp: new Date().toISOString()
            };

            // Send webhook using fetch or your preferred method
            fetch(config.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: "PSRP Staff API",
                    embeds: [webhookEmbed]
                })
            }).catch(console.error);
        }

        let embed = new EmbedBuilder()
            .setTitle("📅 Week Advanced")
            .setDescription(`Staff week tracking has been advanced.\n\n**Previous Week:** ${currentWeek}\n**New Week:** ${nextWeek}\n\n✅ All staff hours have been shifted:\n• Week 0 → Week 1\n• Week 1 → Week 2\n• etc.\n• Week 12+ wiped`)
            .setColor("Green")
            .setTimestamp();

        interaction.reply({ embeds: [embed] });
    }

    // /promotions
    if (interaction.commandName === "promotions") {
        const member = interaction.member;
        const requiredMinutes = config.promotion.requiredMinutes || 240;
        const requiredSeconds = requiredMinutes * 60;

        if (!member.roles.cache.some(r => config.promotion.allowedRoles.includes(r.id))) {
            return interaction.reply({ content: "❌ You don't have permission to use this command.", ephemeral: true });
        }

        let weekNum = getWeekNumber(new Date());
        db.all("SELECT discordId, total FROM hours WHERE week = ?", [weekNum], async (err, rows) => {
            if (err) {
                console.error(err);
                return interaction.reply({ content: "⚠️ Database error.", ephemeral: true });
            }

            let eligible = rows.filter(r => r.total >= requiredSeconds);
            if (eligible.length === 0) {
                return interaction.reply({ content: "No staff members are eligible for promotion this week.", ephemeral: true });
            }

            let description = eligible.map(r => {
                let user = client.users.cache.get(r.discordId);
                let name = user ? user.username : r.discordId;
                let hours = Math.floor(r.total / 3600);
                let mins = Math.floor((r.total % 3600) / 60);
                return `✅ **${name}** - ${hours}h ${mins}m`;
            }).join("\n");

            let embed = new EmbedBuilder()
                .setTitle("📈 Promotion Eligible Staff")
                .setDescription(description)
                .addFields({ name: "Requirement", value: `\`${requiredMinutes} minutes\` this week` })
                .setColor("Green")
                .setTimestamp();

            interaction.reply({ embeds: [embed] });
        });
    }
});

client.once("ready", () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
});

// Helper: ISO week number
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    return `${d.getUTCFullYear()}-${weekNo}`;
}

// Helper: Get week with offset
function getWeekWithOffset(date, offsetWeeks) {
    let newDate = new Date(date);
    newDate.setDate(newDate.getDate() + (offsetWeeks * 7));
    return getWeekNumber(newDate);
}

client.login(process.env.TOKEN);