local clockedIn = {}

-- Load config
local configFile = LoadResourceFile(GetCurrentResourceName(), "config.json")
local config = json.decode(configFile)
local DISCORD_ENDPOINT = config.discordEndpoint
local WEBHOOK_URL = config.webhookUrl
local REQUIRED_PERMISSION = config.requiredPermission or "staffclock.use"

-- Function to check if player has required permission
local function hasStaffPermission(src)
    return IsPlayerAceAllowed(src, REQUIRED_PERMISSION)
end

-- Function to get Discord ID
local function getDiscordId(src)
    for _, v in pairs(GetPlayerIdentifiers(src)) do
        if string.sub(v, 1, string.len("discord:")) == "discord:" then
            return string.sub(v, 9)
        end
    end
    return nil
end

-- Function to send clock-in webhook
local function sendClockInWebhook(playerName, playerId, discordId, timestamp)
    PerformHttpRequest("http://localhost:3000/voice-channel/" .. discordId, function(err, text, headers)
        local voiceChannelText = "Not in voice chat"
        if text and text ~= "" then
            local data = json.decode(text)
            if data and data.voiceChannel then
                voiceChannelText = "<#" .. data.voiceChannel .. ">"
            end
        end
        
        local embed = {
            {
                ["title"] = "🟢 Staff Clock-In",
                ["description"] = string.format([[**Name** **Player ID**
%s %s

**Discord**
<@%s>

**Voice Channel**
%s

**Time**
<t:%d:F>

**Staff Activity Logging**]], 
                    playerName, playerId, discordId, voiceChannelText, timestamp),
                ["color"] = 65280,
                ["timestamp"] = os.date("!%Y-%m-%dT%H:%M:%SZ", timestamp)
            }
        }

        PerformHttpRequest(WEBHOOK_URL, function(err, text, headers) end, "POST", json.encode({
            username = "Staff Clockin",
            avatar_url = "https://cdn.discordapp.com/attachments/1234567890/app-icon.png",
            embeds = embed
        }), {["Content-Type"] = "application/json"})
    end, "GET", "", {})
end

-- Function to send clock-out webhook
local function sendClockOutWebhook(playerName, playerId, discordId, timestamp, duration)
    local durationText
    if duration < 60 then
        durationText = duration .. " seconds"
    else
        local minutes = math.floor(duration / 60)
        local seconds = duration % 60
        if seconds > 0 then
            durationText = minutes .. " minutes " .. seconds .. " seconds"
        else
            durationText = minutes .. " minutes"
        end
    end

    PerformHttpRequest("http://localhost:3000/voice-channel/" .. discordId, function(err, text, headers)
        local voiceChannelText = "Not in voice chat"
        if text and text ~= "" then
            local data = json.decode(text)
            if data and data.voiceChannel then
                voiceChannelText = "<#" .. data.voiceChannel .. ">"
            end
        end

        local embed = {
            {
                ["title"] = "🔴 Staff Clock-Out",
                ["description"] = string.format([[**Name** **Player ID**
%s %s

**Discord**
<@%s>

**Voice Channel**
%s

**Time**
<t:%d:F>

**Session Duration**
%s

**Staff Activity Logging**]], 
                    playerName, playerId, discordId, voiceChannelText, timestamp, durationText),
                ["color"] = 16711680,
                ["timestamp"] = os.date("!%Y-%m-%dT%H:%M:%SZ", timestamp)
            }
        }

        PerformHttpRequest(WEBHOOK_URL, function(err, text, headers) end, "POST", json.encode({
            username = "Staff Clockin",
            avatar_url = "https://cdn.discordapp.com/attachments/1234567890/app-icon.png",
            embeds = embed
        }), {["Content-Type"] = "application/json"})
    end, "GET", "", {})
end

-- Clock In
RegisterNetEvent("staff:clockIn", function()
    local src = source
    local playerId = GetPlayerIdentifier(src, 0)
    local discordId = getDiscordId(src)
    local now = os.time()

    if not hasStaffPermission(src) then
        TriggerClientEvent("staff:showNotification", src, {
            title = 'Access Denied',
            description = 'You do not have permission to use staff clock commands!',
            type = 'error',
            position = 'center-right'
        })
        return
    end

    if not discordId then
        TriggerClientEvent("staff:showNotification", src, {
            title = 'System',
            description = 'No Discord ID linked to your account!',
            type = 'error',
            position = 'center-right'
        })
        return
    end

    if clockedIn[playerId] then
        TriggerClientEvent("staff:showNotification", src, {
            title = 'System',
            description = 'You are already clocked in!',
            type = 'error',
            position = 'center-right'
        })
        return
    end

    clockedIn[playerId] = now

    PerformHttpRequest(DISCORD_ENDPOINT, function(err, text, headers) end, "POST", json.encode({
        action = "clockin",
        identifier = playerId,
        discordId = discordId,
        name = GetPlayerName(src),
        timestamp = now
    }), {["Content-Type"] = "application/json"})

    sendClockInWebhook(GetPlayerName(src), src, discordId, now)

    TriggerClientEvent("staff:showNotification", src, {
        title = 'System',
        description = 'You have clocked in.',
        type = 'success',
        position = 'center-right'
    })
end)

-- Clock Out
RegisterNetEvent("staff:clockOut", function()
    local src = source
    local playerId = GetPlayerIdentifier(src, 0)
    local discordId = getDiscordId(src)
    local now = os.time()

    if not hasStaffPermission(src) then
        TriggerClientEvent("staff:showNotification", src, {
            title = 'Access Denied',
            description = 'You do not have permission to use staff clock commands!',
            type = 'error',
            position = 'center-right'
        })
        return
    end

    if not discordId then
        TriggerClientEvent("staff:showNotification", src, {
            title = 'System',
            description = 'No Discord ID linked to your account!',
            type = 'error',
            position = 'center-right'
        })
        return
    end

    if not clockedIn[playerId] then
        TriggerClientEvent("staff:showNotification", src, {
            title = 'System',
            description = 'You are not clocked in!',
            type = 'error',
            position = 'center-right'
        })
        return
    end

    local sessionStart = clockedIn[playerId]
    local duration = now - sessionStart
    clockedIn[playerId] = nil

    PerformHttpRequest(DISCORD_ENDPOINT, function(err, text, headers) end, "POST", json.encode({
        action = "clockout",
        identifier = playerId,
        discordId = discordId,
        name = GetPlayerName(src),
        timestamp = now,
        duration = duration
    }), {["Content-Type"] = "application/json"})

    sendClockOutWebhook(GetPlayerName(src), src, discordId, now, duration)

    TriggerClientEvent("staff:showNotification", src, {
        title = 'System',
        description = 'You clocked out after ' .. math.floor(duration / 60) .. ' minutes.',
        type = 'inform',
        position = 'center-right'
    })
end)

-- Auto Clock-Out on Disconnect
AddEventHandler('playerDropped', function(reason)
    local src = source
    local playerId = GetPlayerIdentifier(src, 0)
    local discordId = getDiscordId(src)
    local playerName = GetPlayerName(src)
    local now = os.time()
    
    if clockedIn[playerId] and discordId then
        local sessionStart = clockedIn[playerId]
        local duration = now - sessionStart
        clockedIn[playerId] = nil

        PerformHttpRequest(DISCORD_ENDPOINT, function(err, text, headers) end, "POST", json.encode({
            action = "clockout",
            identifier = playerId,
            discordId = discordId,
            name = playerName,
            timestamp = now,
            duration = duration
        }), {["Content-Type"] = "application/json"})

        sendClockOutWebhook(playerName, src, discordId, now, duration)
    end
end)

-- ============================================
-- BLOCK /adrev and /adres commands
-- ============================================

RegisterCommand('adrev', function(source, args, rawCommand)
    local playerId = GetPlayerIdentifier(source, 0)
    
    if not clockedIn[playerId] then
        TriggerClientEvent("staff:showNotification", source, {
            title = 'Clock In Required',
            description = 'You must clock in before using this command!',
            type = 'error',
            position = 'center-right'
        })
        CancelEvent()
        return
    end
end, false)

RegisterCommand('adres', function(source, args, rawCommand)
    local playerId = GetPlayerIdentifier(source, 0)
    
    if not clockedIn[playerId] then
        TriggerClientEvent("staff:showNotification", source, {
            title = 'Clock In Required',
            description = 'You must clock in before using this command!',
            type = 'error',
            position = 'center-right'
        })
        CancelEvent()
        return
    end
end, false)