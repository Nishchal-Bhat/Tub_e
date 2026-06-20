const { google } = require('googleapis');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 8085;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let sseClients = [];
function broadcastProgress(msg) {
    sseClients.forEach(client => client.write(`data: ${msg}\n\n`));
}

let abortUpdateFlag = false;
let isUpdating = false;
let vidsNum = 12; // 3 rows of 4
let shortsNum = 15; // 3 rows of 5

app.all('/abortUpdate', (req, res) => {
    abortUpdateFlag = true;
    res.send('Aborting update...');
});

// ! 👇👇👇 REPLACE WITH YOUR YOUTUBE API DETAILS
const CLIENT_ID = '123qwe';
const CLIENT_SECRET = '123qwe';
const REFRESH_TOKEN = '123qwe';
// ! 👆👆👆 REPLACE WITH YOUR YOUTUBE API DETAILS

let dbDir = path.join(__dirname);

function formatDuration(isoString) {
    const match = isoString.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return "0:00";
    const h = match[1] ? parseInt(match[1].replace('H', '')) : 0;
    const m = match[2] ? parseInt(match[2].replace('M', '')) : 0;
    const s = match[3] ? parseInt(match[3].replace('S', '')) : 0;
    let res = "";
    if (h > 0) res += h + ":";
    res += (h > 0 ? m.toString().padStart(2, '0') : m) + ":";
    res += s.toString().padStart(2, '0');
    return res;
}

function getDurationSeconds(isoString) {
    const match = isoString.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 0;
    const h = match[1] ? parseInt(match[1].replace('H', '')) : 0;
    const m = match[2] ? parseInt(match[2].replace('M', '')) : 0;
    const s = match[3] ? parseInt(match[3].replace('S', '')) : 0;
    return h * 3600 + m * 60 + s;
}

function syncUntagged(dbObject) {
    let taggedHandles = new Set();
    for (const tag in dbObject.tags) {
        if (tag !== '<untagged>') {
            dbObject.tags[tag].forEach(h => taggedHandles.add(h));
        }
    }

    const oldUntagged = dbObject.tags['<untagged>'] || [];
    const newUntagged = [];

    // Keep existing untagged channels in their current order if still untagged
    oldUntagged.forEach(handle => {
        if (!taggedHandles.has(handle) && dbObject.subs[handle]) {
            newUntagged.push(handle);
        }
    });

    // Add any newly orphaned channels to the end
    const untaggedSet = new Set(newUntagged);
    for (const handle in dbObject.subs) {
        if (!taggedHandles.has(handle) && !untaggedSet.has(handle) && dbObject.subs[handle]) {
            newUntagged.push(handle);
        }
    }

    if (newUntagged.length > 0) {
        dbObject.tags['<untagged>'] = newUntagged;
    } else {
        delete dbObject.tags['<untagged>'];
    }
}

(() => {
    const dbPathStartup = path.join(dbDir, 'db.json');
    if (!fs.existsSync(dbPathStartup)) {
        fs.writeFileSync(dbPathStartup, JSON.stringify({ subs: {}, tags: {} }, null, 2));
    } else {
        try {
            const content = fs.readFileSync(dbPathStartup, 'utf8').trim();
            if (!content) {
                fs.writeFileSync(dbPathStartup, JSON.stringify({ subs: {}, tags: {} }, null, 2));
            } else {
                let dbObject = JSON.parse(content);
                if (!dbObject.subs) dbObject.subs = {};
                if (!dbObject.tags) dbObject.tags = {};
                syncUntagged(dbObject);
                fs.writeFileSync(dbPathStartup, JSON.stringify(dbObject, null, 2));
            }
        } catch (e) {
            console.error('Error syncing untagged on startup:', e);
        }
    }
})();

async function updateVidsApi(handle, subsDb, youtube, pageToken = null) {
    if (!subsDb[handle]) {
        console.warn(`\nSkipping channel "${handle}" because it has no data.`);
        return;
    }

    const channelId = subsDb[handle].Id;

    if (!channelId) {
        console.warn(`\nSkipping channel "${handle}" because it is missing an Id.`);
        return;
    }

    if (!subsDb[handle].vids) {
        subsDb[handle].vids = [];
    }

    try {
        const playlistId = channelId.replace(/^UC/, 'UULF');
        const params = {
            part: 'snippet',
            playlistId: playlistId,
            maxResults: vidsNum
        };
        if (pageToken) {
            params.pageToken = pageToken;
        }
        const response = await youtube.playlistItems.list(params);

        let items = response.data.items;
        const newVids = [];

        if (items.length > 0) {
            const videoIds = items.map(item => item.snippet.resourceId.videoId);

            const videosResponse = await youtube.videos.list({
                part: 'snippet,contentDetails,statistics',
                id: videoIds.join(',')
            });

            const videoDetailsMap = {};
            if (videosResponse.data.items) {
                videosResponse.data.items.forEach(vid => {
                    const durationIso = vid.contentDetails?.duration || "PT0S";
                    videoDetailsMap[vid.id] = {
                        duration: formatDuration(durationIso),
                        seconds: getDurationSeconds(durationIso),
                        views: vid.statistics?.viewCount || "0",
                        liveStatus: vid.snippet?.liveBroadcastContent || "none"
                    };
                });
            }

            items.slice().reverse().forEach(item => {
                const videoId = item.snippet.resourceId.videoId;
                const link = `https://www.youtube.com/watch?v=${videoId}`;
                const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                const details = videoDetailsMap[videoId] || { duration: "0:00", seconds: 0, views: "0", liveStatus: "none" };

                newVids.push({
                    title: item.snippet.title,
                    thumbnail: thumbnailUrl,
                    link: link,
                    channelname: item.snippet.channelTitle,
                    timeUploaded: item.snippet.publishedAt,
                    duration: details.duration,
                    views: details.views,
                    liveStatus: details.liveStatus
                });
            });

            newVids.sort((a, b) => new Date(b.timeUploaded) - new Date(a.timeUploaded));

            if (pageToken) {
                subsDb[handle].vids = subsDb[handle].vids.concat(newVids);
                subsDb[handle].vids.sort((a, b) => new Date(b.timeUploaded) - new Date(a.timeUploaded));
            } else {
                subsDb[handle].vids = newVids;
            }
        }
        const newNextPageToken = response.data.nextPageToken || null;
        subsDb[handle].nextPageToken = newNextPageToken;
        return { newVids, newNextPageToken };
    } catch (err) {
        console.error(`\nFailed to fetch API for channel ${handle}:`, err.message);
        return { newVids: [], newNextPageToken: pageToken };
    }
}

async function updateShortsApi(handle, subsDb, youtube, pageToken = null) {
    if (!subsDb[handle]) {
        console.warn(`\nSkipping channel "${handle}" because it has no data.`);
        return;
    }

    const channelId = subsDb[handle].Id;

    if (!channelId) {
        console.warn(`\nSkipping channel "${handle}" because it is missing an Id.`);
        return;
    }

    if (!subsDb[handle].shorts) {
        subsDb[handle].shorts = [];
    }

    try {
        const playlistId = channelId.replace(/^UC/, 'UUSH');
        const params = {
            part: 'snippet',
            playlistId: playlistId,
            maxResults: shortsNum
        };
        if (pageToken) {
            params.pageToken = pageToken;
        }
        const response = await youtube.playlistItems.list(params);

        let items = response.data.items;
        const newShorts = [];

        if (items.length > 0) {
            const videoIds = items.map(item => item.snippet.resourceId.videoId);

            const videosResponse = await youtube.videos.list({
                part: 'snippet,contentDetails,statistics',
                id: videoIds.join(',')
            });

            const videoDetailsMap = {};
            if (videosResponse.data.items) {
                videosResponse.data.items.forEach(vid => {
                    const durationIso = vid.contentDetails?.duration || "PT0S";
                    videoDetailsMap[vid.id] = {
                        duration: formatDuration(durationIso),
                        seconds: getDurationSeconds(durationIso),
                        views: vid.statistics?.viewCount || "0",
                        liveStatus: vid.snippet?.liveBroadcastContent || "none"
                    };
                });
            }

            items.slice().reverse().forEach(item => {
                const videoId = item.snippet.resourceId.videoId;
                const link = `https://www.youtube.com/watch?v=${videoId}`;
                const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
                const details = videoDetailsMap[videoId] || { duration: "0:00", seconds: 0, views: "0", liveStatus: "none" };

                newShorts.push({
                    title: item.snippet.title,
                    thumbnail: thumbnailUrl,
                    link: link,
                    channelname: item.snippet.channelTitle,
                    timeUploaded: item.snippet.publishedAt,
                    duration: details.duration,
                    views: details.views,
                    liveStatus: details.liveStatus
                });
            });

            newShorts.sort((a, b) => new Date(b.timeUploaded) - new Date(a.timeUploaded));

            if (pageToken) {
                subsDb[handle].shorts = subsDb[handle].shorts.concat(newShorts);
                subsDb[handle].shorts.sort((a, b) => new Date(b.timeUploaded) - new Date(a.timeUploaded));
            } else {
                subsDb[handle].shorts = newShorts;
            }
        }
        const newNextPageToken = response.data.nextPageToken || null;
        subsDb[handle].nextShortsPageToken = newNextPageToken;
        return { newShorts, newNextPageToken };
    } catch (err) {
        const isExpectedError = err.errors && err.errors[0] &&
            (err.errors[0].reason === 'playlistNotFound' || err.errors[0].reason === 'invalidValue');

        if (isExpectedError) {
            // This is expected for channels that have no shorts, as the UUSH playlist does not exist.
            subsDb[handle].shorts = [];
            subsDb[handle].nextShortsPageToken = null;
            return { newShorts: [], newNextPageToken: null };
        }
        console.error(`\nFailed to fetch API for channel ${handle} shorts:`, err);
        return { newShorts: [], newNextPageToken: pageToken };
    }
}

async function updateListVids(tag = 'regular') {
    console.log(`Starting DB update for tag '${tag}'...`);
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return false;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        const handlesToUpdate = (db.tags[tag] || []).filter(handle => db.subs[handle]);

        if (handlesToUpdate.length === 0) {
            console.log(`No channels found with tag '${tag}'.`);
            return false;
        }

        const youtube = getYoutubeClient();

        let count = 0;
        const total = handlesToUpdate.length;
        const batchSize = 15; // Increased for maximum safe performance

        for (let i = 0; i < total; i += batchSize) {
            if (abortUpdateFlag) {
                console.log(`\nDB update aborted by user for tag '${tag}'.`);
                break;
            }
            const batch = handlesToUpdate.slice(i, i + batchSize);
            const promises = batch.map(handle => updateVidsApi(handle, db.subs, youtube));
            await Promise.all(promises);
            count += batch.length;
            if (!abortUpdateFlag) {
                // process.stdout.write(`\rupdated (${count}/${total})`);
                broadcastProgress(`Updating ${tag} vids (${count}/${total})...`);
            }
        }

        // Merge updated videos with a fresh copy of the DB to avoid overwriting recent user changes
        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        for (const handle of handlesToUpdate) {
            if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].vids) {
                freshDb.subs[handle].vids = db.subs[handle].vids;
                freshDb.subs[handle].nextPageToken = db.subs[handle].nextPageToken;
            }
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));

        if (abortUpdateFlag) return true;

        console.log(`\nDB update complete for tag '${tag}'!`);
        return false;
    } catch (error) {
        console.error('\nCritical error in updateVids:', error);
        return false;
    }
}

async function updateListShorts(tag = 'regular') {
    console.log(`Starting DB shorts update for tag '${tag}'...`);
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return false;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        const handlesToUpdate = (db.tags[tag] || []).filter(handle => db.subs[handle]);

        if (handlesToUpdate.length === 0) {
            console.log(`No channels found with tag '${tag}'.`);
            return false;
        }

        const youtube = getYoutubeClient();

        let count = 0;
        const total = handlesToUpdate.length;
        const batchSize = 15; // Increased for maximum safe performance

        for (let i = 0; i < total; i += batchSize) {
            if (abortUpdateFlag) {
                console.log(`\nDB shorts update aborted by user for tag '${tag}'.`);
                break;
            }
            const batch = handlesToUpdate.slice(i, i + batchSize);
            const promises = batch.map(handle => updateShortsApi(handle, db.subs, youtube));
            await Promise.all(promises);
            count += batch.length;
            if (!abortUpdateFlag) {
                broadcastProgress(`Updating ${tag} shorts (${count}/${total})...`);
            }
        }

        // Merge updated videos with a fresh copy of the DB to avoid overwriting recent user changes
        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        for (const handle of handlesToUpdate) {
            if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].shorts) {
                freshDb.subs[handle].shorts = db.subs[handle].shorts;
                freshDb.subs[handle].nextShortsPageToken = db.subs[handle].nextShortsPageToken;
            }
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));

        if (abortUpdateFlag) return true;

        console.log(`\nDB shorts update complete for tag '${tag}'!`);
        return false;
    } catch (error) {
        console.error('\nCritical error in updateListShorts:', error);
        return false;
    }
}

async function updateAllVids() {
    console.log(`Starting DB update for all channels...`);
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return false;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const handlesToUpdate = Object.keys(db.subs || {}).filter(handle => db.subs[handle]);

        if (handlesToUpdate.length === 0) {
            console.log(`No channels found in DB.`);
            return false;
        }

        const youtube = getYoutubeClient();
        let count = 0;
        const total = handlesToUpdate.length;
        const batchSize = 15; // Increased for maximum safe performance

        for (let i = 0; i < total; i += batchSize) {
            if (abortUpdateFlag) {
                console.log(`\nDB update aborted by user for all channels.`);
                break;
            }
            const batch = handlesToUpdate.slice(i, i + batchSize);
            const promises = batch.map(handle => updateVidsApi(handle, db.subs, youtube));
            await Promise.all(promises);
            count += batch.length;
            if (!abortUpdateFlag) {
                // process.stdout.write(`\rupdated (${count}/${total})`);
                broadcastProgress(`Updating all vids (${count}/${total})...`);
            }
        }

        // Merge updated videos with a fresh copy of the DB to avoid overwriting recent user changes
        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        for (const handle of handlesToUpdate) {
            if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].vids) {
                freshDb.subs[handle].vids = db.subs[handle].vids;
                freshDb.subs[handle].nextPageToken = db.subs[handle].nextPageToken;
            }
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));

        if (abortUpdateFlag) return true;

        console.log(`\nDB update complete for all channels!`);
        return false;
    } catch (error) {
        console.error('\nCritical error in updateAllVids:', error);
        return false;
    }
}

async function updateAllShorts() {
    console.log(`Starting DB shorts update for all channels...`);
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return false;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const handlesToUpdate = Object.keys(db.subs || {}).filter(handle => db.subs[handle]);

        if (handlesToUpdate.length === 0) {
            console.log(`No channels found in DB.`);
            return false;
        }

        const youtube = getYoutubeClient();
        let count = 0;
        const total = handlesToUpdate.length;
        const batchSize = 15; // Increased for maximum safe performance

        for (let i = 0; i < total; i += batchSize) {
            if (abortUpdateFlag) {
                console.log(`\nDB shorts update aborted by user for all channels.`);
                break;
            }
            const batch = handlesToUpdate.slice(i, i + batchSize);
            const promises = batch.map(handle => updateShortsApi(handle, db.subs, youtube));
            await Promise.all(promises);
            count += batch.length;
            if (!abortUpdateFlag) {
                broadcastProgress(`Updating all shorts (${count}/${total})...`);
            }
        }

        // Merge updated videos with a fresh copy of the DB to avoid overwriting recent user changes
        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        for (const handle of handlesToUpdate) {
            if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].shorts) {
                freshDb.subs[handle].shorts = db.subs[handle].shorts;
                freshDb.subs[handle].nextShortsPageToken = db.subs[handle].nextShortsPageToken;
            }
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));

        if (abortUpdateFlag) return true;

        console.log(`\nDB shorts update complete for all channels!`);
        return false;
    } catch (error) {
        console.error('\nCritical error in updateAllShorts:', error);
        return false;
    }
}

async function updateChannelVids(handle) {
    console.log(`Starting DB update for single channel '${handle}'...`);
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        if (!db.subs[handle]) {
            console.error(`Error: Channel '${handle}' not found in DB.`);
            return;
        }

        const youtube = getYoutubeClient();
        await updateVidsApi(handle, db.subs, youtube);

        // Merge updated video array with fresh db
        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].vids) {
            freshDb.subs[handle].vids = db.subs[handle].vids;
            freshDb.subs[handle].nextPageToken = db.subs[handle].nextPageToken;
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));
        console.log(`DB update complete for channel '${handle}'!`);
    } catch (error) {
        console.error('Critical error in updateSingleChannel:', error);
    }
}

async function updateChannelShorts(handle) {
    console.log(`Starting DB shorts update for single channel '${handle}'...`);
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        if (!db.subs[handle]) {
            console.error(`Error: Channel '${handle}' not found in DB.`);
            return;
        }

        const youtube = getYoutubeClient();
        await updateShortsApi(handle, db.subs, youtube);

        // Merge updated video array with fresh db
        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].shorts) {
            freshDb.subs[handle].shorts = db.subs[handle].shorts;
            freshDb.subs[handle].nextShortsPageToken = db.subs[handle].nextShortsPageToken;
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));
        console.log(`DB shorts update complete for channel '${handle}'!`);
    } catch (error) {
        console.error('Critical error in updateChannelShorts:', error);
    }
}

async function loadMoreVids(handle) {
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        if (!db.subs[handle]) {
            console.error(`Error: Channel '${handle}' not found in DB.`);
            return;
        }

        const pageToken = db.subs[handle].nextPageToken;
        if (!pageToken) return;

        const youtube = getYoutubeClient();
        const result = await updateVidsApi(handle, db.subs, youtube, pageToken);

        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].vids) {
            freshDb.subs[handle].vids = db.subs[handle].vids;
            freshDb.subs[handle].nextPageToken = db.subs[handle].nextPageToken;
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));
        return result;
    } catch (error) {
        console.error('Critical error in loadMoreVids:', error);
        return null;
    }
}

async function loadMoreShorts(handle) {
    abortUpdateFlag = false;
    try {
        const dbPath = path.join(dbDir, 'db.json');

        if (!fs.existsSync(dbPath)) {
            console.error(`Error: Could not find db.json at ${dbPath}`);
            return;
        }

        let db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        if (!db.subs[handle]) {
            console.error(`Error: Channel '${handle}' not found in DB.`);
            return;
        }

        const pageToken = db.subs[handle].nextShortsPageToken;
        if (!pageToken) return;

        const youtube = getYoutubeClient();
        const result = await updateShortsApi(handle, db.subs, youtube, pageToken);

        let freshDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (freshDb.subs[handle] && db.subs[handle] && db.subs[handle].shorts) {
            freshDb.subs[handle].shorts = db.subs[handle].shorts;
            freshDb.subs[handle].nextShortsPageToken = db.subs[handle].nextShortsPageToken;
        }
        fs.writeFileSync(dbPath, JSON.stringify(freshDb, null, 2));
        return result;
    } catch (error) {
        console.error('Critical error in loadMoreShorts:', error);
        return null;
    }
}

function getYoutubeClient() {
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
    return google.youtube({ version: 'v3', auth: oauth2Client });
}

async function getSubscriptions(youtube) {
    console.log('🔄 Fetching all subscriptions...');
    let pageToken = null;
    const allSubIds = [];

    do {
        const response = await youtube.subscriptions.list({
            part: 'snippet',
            mine: true,
            maxResults: 50,
            pageToken: pageToken
        });
        const ids = response.data.items.map(item => item.snippet.resourceId.channelId);
        allSubIds.push(...ids);
        pageToken = response.data.nextPageToken;
    } while (pageToken);

    const finalData = [];
    for (let i = 0; i < allSubIds.length; i += 50) {
        const chunk = allSubIds.slice(i, i + 50);
        const channelRes = await youtube.channels.list({
            part: 'snippet',
            id: chunk.join(',')
        });
        channelRes.data.items.forEach(item => {
            finalData.push({
                name: item.snippet.title,
                handle: item.snippet.customUrl || 'No Handle',
                Id: item.id,
                profilePic: item.snippet.thumbnails?.default?.url || ''
            });
        });
    }
    console.log(`✅ Subscriptions done! Total subs: ${finalData.length}`);
    return finalData;
}

async function retrieve() {
    try {
        const youtube = getYoutubeClient();

        // 1. Fetch data
        const subs = await getSubscriptions(youtube);

        console.log('🏗️ Updating db.json with current subscriptions...');
        const outputPath = path.join(dbDir, 'db.json');
        let existingDb = { subs: {}, tags: {} };
        if (fs.existsSync(outputPath)) {
            existingDb = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        }

        if (!existingDb.subs) existingDb.subs = {};
        if (!existingDb.tags) existingDb.tags = {};

        const subMap = new Map(subs.map(s => [s.Id, s]));

        // Remove unsubscribed channels
        for (const handle in existingDb.subs) {
            const channelId = existingDb.subs[handle].Id;
            if (!subMap.has(channelId)) {
                console.log(`Removing unsubscribed channel: ${handle}`);
                delete existingDb.subs[handle];

                // Clean up tags pointing to this handle
                for (const tag in existingDb.tags) {
                    existingDb.tags[tag] = existingDb.tags[tag].filter(h => h !== handle);

                    if (existingDb.tags[tag].length === 0) {
                        delete existingDb.tags[tag];
                    }
                }
            }
        }

        // Add new subscribed channels
        for (const sub of subs) {
            if (!existingDb.subs[sub.handle]) {
                console.log(`Adding new subscribed channel: ${sub.handle}`);
                existingDb.subs[sub.handle] = sub;
                existingDb.subs[sub.handle].timecutoff = null;
                existingDb.subs[sub.handle].timecutoffShorts = null;
            }
        }

        syncUntagged(existingDb);
        fs.writeFileSync(outputPath, JSON.stringify(existingDb, null, 2));
        console.log(`\n🎉 Success! db.json updated. Total subscriptions: ${Object.keys(existingDb.subs).length}`);

    } catch (err) {
        console.error('An error occurred during orchestration:', err);
    }
}

function addTags(handle, tag) {
    const dbPath = path.join(dbDir, 'db.json');
    if (fs.existsSync(dbPath)) {
        let dbObject = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (dbObject.subs[handle]) {
            if (!dbObject.tags[tag]) dbObject.tags[tag] = [];
            if (!dbObject.tags[tag].includes(handle)) {
                dbObject.tags[tag].push(handle);
                syncUntagged(dbObject);
                fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
                console.log(`🏷️ Added channel '${handle}' to tag '${tag}' in db.json`);
            }
        }
    }
}

function removeTag(handle, tag) {
    const dbPath = path.join(dbDir, 'db.json');
    if (fs.existsSync(dbPath)) {
        let dbObject = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (dbObject.tags[tag]) {
            dbObject.tags[tag] = dbObject.tags[tag].filter(h => h !== handle);

            if (dbObject.tags[tag].length === 0) {
                delete dbObject.tags[tag];
            }
            syncUntagged(dbObject);
            fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
            console.log(`🏷️ Removed channel '${handle}' from tag '${tag}' in db.json`);
        }
    }
}

app.get('/retrieve', async (req, res) => {
    await retrieve();
    res.send('Database update completed successfully.');
});

app.get('/updateProgress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.push(res);
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

app.get('/updateVids', async (req, res) => {
    if (isUpdating) {
        return res.send('Update already in progress.');
    }
    isUpdating = true;
    try {
        const tag = req.query.tag || 'regular';
        let aborted = false;
        if (tag === 'all') {
            aborted = await updateAllVids();
        } else {
            aborted = await updateListVids(tag);
        }
        if (aborted) {
            res.send(`Database update for ${tag === 'all' ? 'all channels' : `tag "${tag}"`} aborted.`);
        } else {
            res.send(`Database update for ${tag === 'all' ? 'all channels' : `tag "${tag}"`} completed successfully.`);
        }
    } finally {
        isUpdating = false;
    }
});

app.get('/updateShorts', async (req, res) => {
    if (isUpdating) {
        return res.send('Update already in progress.');
    }
    isUpdating = true;
    try {
        const tag = req.query.tag || 'regular';
        let aborted = false;
        if (tag === 'all') {
            aborted = await updateAllShorts();
        } else {
            aborted = await updateListShorts(tag);
        }
        if (aborted) {
            res.send(`Database shorts update for ${tag === 'all' ? 'all channels' : `tag "${tag}"`} aborted.`);
        } else {
            res.send(`Database shorts update for ${tag === 'all' ? 'all channels' : `tag "${tag}"`} completed successfully.`);
        }
    } finally {
        isUpdating = false;
    }
});

app.get('/updateChannel', async (req, res) => {
    const handle = req.query.handle;
    if (!handle) {
        return res.status(400).send('Handle query parameter is required.');
    }
    if (isUpdating) {
        return res.send('Update already in progress.');
    }
    isUpdating = true;
    try {
        await updateChannelVids(handle);
        res.send(`Database update for channel "${handle}" completed successfully.`);
    } finally {
        isUpdating = false;
    }
});

app.get('/updateChannelShorts', async (req, res) => {
    const handle = req.query.handle;
    if (!handle) {
        return res.status(400).send('Handle query parameter is required.');
    }
    if (isUpdating) {
        return res.send('Update already in progress.');
    }
    isUpdating = true;
    try {
        await updateChannelShorts(handle);
        res.send(`Database shorts update for channel "${handle}" completed successfully.`);
    } finally {
        isUpdating = false;
    }
});

app.get('/loadMoreVids', async (req, res) => {
    const handle = req.query.handle;
    if (!handle) {
        return res.status(400).send('Handle query parameter is required.');
    }
    if (isUpdating) {
        return res.send('Update already in progress.');
    }
    isUpdating = true;
    try {
        const data = await loadMoreVids(handle);
        res.json(data || { newVids: [], newNextPageToken: null });
    } finally {
        isUpdating = false;
    }
});

app.get('/loadMoreShorts', async (req, res) => {
    const handle = req.query.handle;
    if (!handle) {
        return res.status(400).send('Handle query parameter is required.');
    }
    if (isUpdating) {
        return res.send('Update already in progress.');
    }
    isUpdating = true;
    try {
        const data = await loadMoreShorts(handle);
        res.json(data || { newShorts: [], newNextPageToken: null });
    } finally {
        isUpdating = false;
    }
});

app.get('/addTag', (req, res) => {
    const handle = req.query.handle;
    const tag = req.query.tag;
    if (!handle || !tag) {
        return res.status(400).send('Handle and tag query parameters are required.');
    }
    addTags(handle, tag);
    res.send(`Tag "${tag}" added to channel "${handle}" successfully.`);
});

app.get('/removeTag', (req, res) => {
    const handle = req.query.handle;
    const tag = req.query.tag;
    if (!handle || !tag) {
        return res.status(400).send('Handle and tag query parameters are required.');
    }
    removeTag(handle, tag);
    res.send(`Tag "${tag}" removed from channel "${handle}" successfully.`);
});

app.post('/renameTag', (req, res) => {
    const { oldTag, newTag } = req.body;
    if (!oldTag || !newTag) {
        return res.status(400).send('Invalid request');
    }
    const dbPath = path.join(dbDir, 'db.json');
    if (fs.existsSync(dbPath)) {
        let dbObject = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (dbObject.tags[oldTag]) {
            if (dbObject.tags[newTag]) {
                const combined = [...dbObject.tags[newTag], ...dbObject.tags[oldTag]];
                dbObject.tags[newTag] = [...new Set(combined)];
                delete dbObject.tags[oldTag];
                fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
                return res.send('Merged successfully');
            }
            const newTags = {};
            for (const t in dbObject.tags) {
                if (t === oldTag) {
                    newTags[newTag] = dbObject.tags[oldTag];
                } else {
                    newTags[t] = dbObject.tags[t];
                }
            }
            dbObject.tags = newTags;
            fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
            return res.send('Renamed successfully');
        }
    }
    res.status(404).send('Tag not found');
});

app.post('/reorderTag', (req, res) => {
    const { tag, handles } = req.body;
    if (!tag || !handles || !Array.isArray(handles)) {
        return res.status(400).send('Invalid request');
    }
    const dbPath = path.join(dbDir, 'db.json');
    if (fs.existsSync(dbPath)) {
        let dbObject = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (dbObject.tags[tag]) {
            dbObject.tags[tag] = handles;
            fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
            return res.send('Reordered successfully');
        }
    }
    res.status(404).send('Tag not found');
});

app.post('/reorderTagsList', (req, res) => {
    const { tags } = req.body;
    if (!tags || !Array.isArray(tags)) {
        return res.status(400).send('Invalid request');
    }
    const dbPath = path.join(dbDir, 'db.json');
    if (fs.existsSync(dbPath)) {
        let dbObject = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const newTags = {};
        // Reconstruct the object in the exact order requested
        for (const t of tags) {
            if (dbObject.tags[t]) newTags[t] = dbObject.tags[t];
        }
        // Catch any that might have been missed
        for (const t in dbObject.tags) {
            if (!newTags[t]) newTags[t] = dbObject.tags[t];
        }
        dbObject.tags = newTags;
        fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
        return res.send('Tags reordered successfully');
    }
    res.status(404).send('DB not found');
});

app.get('/setCutoff', (req, res) => {
    const handle = req.query.handle;
    const time = req.query.time;
    const type = req.query.type || 'vids';
    if (!handle || !time) {
        return res.status(400).send('Handle and time query parameters are required.');
    }

    const dbPath = path.join(dbDir, 'db.json');
    if (fs.existsSync(dbPath)) {
        let dbObject = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (dbObject.subs[handle]) {
            if (type === 'shorts') {
                dbObject.subs[handle].timecutoffShorts = time;
            } else {
                dbObject.subs[handle].timecutoff = time;
            }
            fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
            return res.send(`Cutoff for "${handle}" ${type} set to ${time}.`);
        }
    }
    res.status(404).send('Channel or DB not found.');
});

app.get('/dbread', (req, res) => {
    const dbPath = path.join(dbDir, 'db.json');
    let dbObject = { subs: {}, tags: {} };
    let shouldWrite = false;

    if (fs.existsSync(dbPath)) {
        try {
            const content = fs.readFileSync(dbPath, 'utf8').trim();
            if (content) {
                const parsed = JSON.parse(content);
                if (!parsed.subs || !parsed.tags) {
                    dbObject = { 
                        subs: parsed.subs || {}, 
                        tags: parsed.tags || {},
                        ...parsed
                    };
                    dbObject.subs = dbObject.subs || {};
                    dbObject.tags = dbObject.tags || {};
                    shouldWrite = true;
                } else {
                    return res.sendFile(dbPath);
                }
            } else {
                shouldWrite = true;
            }
        } catch (e) {
            shouldWrite = true;
        }
    } else {
        shouldWrite = true;
    }

    if (shouldWrite) {
        try {
            fs.writeFileSync(dbPath, JSON.stringify(dbObject, null, 2));
        } catch (e) {
            console.error('Error writing skeleton db.json:', e);
        }
        res.json(dbObject);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
