fx_version 'cerulean'
game 'gta5'

author 'Crow'
description 'Staff Clock In/Out with Discord integration'
version '1.0.0'

dependencies {
    'DiscordAcePerms'
}

shared_scripts {
    '@ox_lib/init.lua'
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server.lua',
}

client_scripts {
    'client.lua',
}