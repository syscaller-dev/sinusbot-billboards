registerPlugin({
    name: 'billboard',
    version: '1.2',
    description: 'Shows the active Users from your Teamspeak in a Channel',
    author: 'syscaller <https://github.com/syscaller-dev>',
    backends: ["ts3"],
    vars: [
        {
            name: 'channels',
            title: 'Channels that display the infos:',
            type: 'array',
            vars: [
                {
                    name: 'displayChannel',
                    title: 'The Channel to display the connected Users',
                    type: 'channel',
                },
                {
                    name: 'nameTemplate',
                    title: 'Template for the Name of the Channel ({userCount}, {groupCount<id>})',
                    type: 'string',
                    placeholder: 'Users: [{userCount}] Admins: [{groupCount0}]',
                },
                {
                    name: 'descriptionTemplate',
                    title: 'Template for the Description of the Channel ({userCount}, {users}, {groupCount<id>}, {group<id>})',
                    type: 'multiline',
                    placeholder: 'Users [{userCount}]:\n{users}'
                },
                {
                    name: 'userTemplate',
                    title: 'Template to show the User in the Description ({clientURL}, {clientID}, {username}, {onlineTime}, {firstSeen})',
                    type: 'string',
                    placeholder: '[URL={clientURL}]{username}[/URL] [{onlineTime}]'
                },
                {
                    name:'visibleEvent',
                    title:'Updates the Channel when the client joins/disconnects or gets visible/invisible to the bot',
                    type: 'checkbox',
                    default: true
                },
                {
                    name:'nameEvent',
                    title:'Updates the Channel when the nickname changes',
                    type: 'checkbox',
                    default: true
                },
                {
                    name:'serverGroupEvent',
                    title:'Updates the Channel when the serverGroups of a user changes',
                    type: 'checkbox',
                    default: true
                }
            ]
        },
        {
            name:'minuteString',
            title: 'Set the minute representation for timespans',
            type: 'string',
            default: 'minutes'
        },
        {
            name:'hourString',
            title: 'Set the hour representation for timespans',
            type: 'string',
            default: 'hours'
        },
        {
            name:'dayString',
            title: 'Set the day representation for timespans',
            type: 'string',
            default: 'days'
        },
        {
            name:'weekString',
            title: 'Set the week representation for timespans',
            type: 'string',
            default: 'weeks'
        },
        {
            name:'yearDate',
            title: 'Set the Date representation from the year',
            type: 'select',
            options: ['none','numeric','2-digit'],
            default: 1
        },
        {
            name:'monthDate',
            title: 'Set the Date representation from the month',
            type: 'select',
            options: ['none','numeric','2-digit','narrow','short','long'],
            default: 4
        },
        {
            name:'dayDate',
            title: 'Set the Date representation from the day',
            type: 'select',
            options: ['none','numeric','2-digit'],
            default: 0
        },
    ]
}, function (_, config, meta) {
    const event = require('event');
    const backend = require('backend');
    const engine = require('engine');

    //vars
    var namePatterns = [];
    var descriptionPatterns = [];
    var userPatterns = [];

    //flags
    const patternMode = {
        channelName: 1,
        description: 2,
        user: 4
    };

    //functions
    
    function convertURL(url) {
        var splitter = url.indexOf('~') + 1;
        var username = url.substring(splitter);
        url = url.substring(0, splitter);
        return decodeURIComponent(url) + username;
    }

    function prettifyTimespan(milliseconds) {
        var minutes = milliseconds / 60000;
        if (minutes < 60)
            return `${Math.floor(minutes)} ${config.minuteString}`;
        var hours = minutes / 60;
        if (hours < 24)
            return `${Math.floor(hours)} ${config.hourString} ${Math.floor(minutes % 60)} ${config.minuteString}`;
        var days = hours / 24;
        if (days < 7)
            return `${Math.floor(days)} ${config.dayString} ${Math.floor(hours % 24)} ${config.minuteString}`;
        return `${Math.floor(days / 7)}  ${config.weekString} ${Math.floor(days % 7)} ${config.dayString}`;
    }

    function getDateString(date = new Date()){
        const optionvalues = [undefined,'numeric','2-digit','narrow','short','long']
        var dateoptions = {year:optionvalues[config.yearDate],month:optionvalues[config.monthDate],day:optionvalues[config.dayDate]}
        return date.toLocaleDateString("en-US",dateoptions);
    }

    function getGroupMembers(id, users = backend.getClients()) {
        return users.filter(client => client.getServerGroups().some(group => group.id() === id));
    }

    function setPattern(regex, func, mode) {
        if (!(regex.constructor.name === 'RegExp')) throw new Error('Parameter regex needs to be a RegExp');
        if (!(typeof func === 'function')) throw new Error('Parameter func needs to be a function');
        var patternObj = { 'regex': regex, 'func': func };
        if (mode & patternMode.channelName) {
            namePatterns.push(patternObj);
        }
        if (mode & patternMode.description) {
            descriptionPatterns.push(patternObj);
        }
        if (mode & patternMode.user) {
            userPatterns.push(patternObj);
        }
    }

    function replacePatterns(patternString, patterns, values) {
        patterns.forEach(pattern => {
            patternString = patternString.replace(pattern.regex, (...match) => pattern.func(values, ...match))
        });
        return patternString;
    }

    function getUserStringFunction(channelConfig) {
        return (clients) => {
            var userstrings = [];
            clients.forEach(client => {
                var userstr = (channelConfig.userTemplate || '[URL={clientURL}]{username}[/URL] [{onlineTime}]');
                userstr = replacePatterns(userstr, userPatterns, {'client':client});
                userstrings.push(userstr);
            });
            return userstrings;
        }
    }

    function updateChannel(channelConfig,clients = backend.getClients()) {
        if (channelConfig.displayChannel) {
            var channel = backend.getChannelByID(channelConfig.displayChannel);

            var namestr = channelConfig.nameTemplate;
            var descriptionstr = (channelConfig.descriptionTemplate || 'Users [{userCount}]:\n{users}')

            if (namestr) {
                namestr = replacePatterns(namestr, namePatterns, {'clients':clients});
                channel.setName(namestr);
            }
            descriptionstr = replacePatterns(descriptionstr, descriptionPatterns, {'clients':clients, 'getUserStrings':getUserStringFunction(channelConfig)});
            channel.setDescription(descriptionstr);
        }
    }

    function updateChannels() {
        var clients = backend.getClients();
        config.channels.forEach((channel)=>updateChannel(channel,clients));
    }

    function setupEvents(){
        config.channels.forEach(channelcfg => {
            if(channelcfg.visibleEvent){
                event.on('clientVisible',channelUpdateHandler(channelcfg));
                event.on('clientInvisible',channelUpdateHandler(channelcfg));
            }
            if(channelcfg.nameEvent) event.on('clientNick',channelUpdateHandler(channelcfg));
            if(channelcfg.serverGroupEvent){
                event.on('serverGroupAdded',channelUpdateHandler(channelcfg));
                event.on('serverGroupRemoved',channelUpdateHandler(channelcfg));
            }
        });
    }

    //Channelname and description patterns
    setPattern(/{userCount}/gi, (values) => values.clients.length, patternMode.channelName | patternMode.description);
    setPattern(/{groupCount(\d+)}/gi, (values, match, p1) => getGroupMembers(p1, values.clients).length, patternMode.channelName | patternMode.description);

    //Description patterns
    setPattern(/{users}/gi, (values) => values.getUserStrings(values.clients).join('\n'), patternMode.description);
    setPattern(/{group(\d+)}/gi, (values, match, p1) => values.getUserStrings(getGroupMembers(p1, values.clients)).join('\n'), patternMode.description);

    //User patterns
    setPattern(/{clientID}/gi, (values) => values.client.uid(), patternMode.user);
    setPattern(/{clientURL}/gi, (values) => convertURL(values.client.getURL()), patternMode.user);
    setPattern(/{username}/gi, (values) => values.client.name(), patternMode.user);
    setPattern(/{onlineTime}/gi, (values) => prettifyTimespan(values.client.getOnlineTime()), patternMode.user);
    setPattern(/{firstSeen}/gi, (values) => getDateString(new Date(values.client.getCreationTime())),patternMode.user)

    //handlers
    function channelUpdateHandler(channelConfig){
        return () => updateChannel(channelConfig);
    }

    //events
    updateChannels()
    setupEvents()

    //exports
    module.exports = {
        setPattern,
        updateChannels,
        prettifyTimespan,
        getDateString,
        patternMode
    }
})