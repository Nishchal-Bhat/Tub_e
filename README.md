# Tub_E

Tub_E (pronounced "tube-ey") is a youtube feed browser that lets you organize your subscribed channels with tags.

---
## API : 
You need the "YouTube Data API v3" api for your google account to use this app.If you are not familiar with the process, just ask your AI assistant of choice how to set it up.

After getting the refresh token, make sure to change the status of your google cloud project from "Testing" to "Production", or else the refresh token expires after 7 days.

---
## Instructions : 
Channels are grouped into tags that you can add to each channel.

New videos are only automatically updated for the first tag shown on app startup. When viewing the other tags, make sure to click "Update tag" or press "v".

---
## Keyboard Shortcuts : 
|key|action|
|-|-|
|s|toggle sidebar visibility|
|c|update videos/shorts for the active channel|
|v|update videos/shorts for all the channels in the active tag|
|z|toggle between viewing videos and shorts|
|x|toggle cutoff filtering <sup>1</sup>|
|w|pick video for cutoff <sup>1</sup>|
|e|video selection mode <sup>2</sup>|
|r|rename tag|
|f|toggle adding tag to filtering <sup>3</sup>|
|t|add a tag to the active channel|
|/|jump to the search bar|

### ** __NOTE__ : 
<sup>1</sup> You can pick a video as a cutoff for each channel. When a cutoff is set, only videos posted after the cutoff time will be shown by default. This filter can be toggled.

<sup>2</sup> Press enter to open the video. Press ctrl+enter to open the video in the background.

<sup>3</sup> When tags are added for filtering, of all the channels in the active tag list, only those labelled with all the tags picked, are shown. All the tags added to filter are shown in the top left.

---

RIP "Gemini code assist" extension for vscode 😢😢

The frontend was built entirely using it.

Was the best workflow ever.

I'll never forgive google for removing it 😭😭