RegisterCommand("clockin", function()
    TriggerServerEvent("staff:clockIn")
end)

RegisterCommand("clockout", function()
    TriggerServerEvent("staff:clockOut")
end)

-- Handle notifications from server
RegisterNetEvent("staff:showNotification", function(notificationData)
    if lib and lib.notify then
        lib.notify(notificationData)
    else
        print("ox_lib not available - notification: " .. notificationData.description)
    end
end)