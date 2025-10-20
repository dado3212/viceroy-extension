# <img src='./public/icons/icon-128.png' height='24' /> Viceroy

A Chrome extension in the vein of the [official Monarch retail purchase sync extension](https://chromewebstore.google.com/detail/monarch-money-retail-purc/imfcckkmcklambpijbgcebggegggkgla), but for other categories of transactions. Currently it only works for Uber and Uber Eats, but may add additional options in the future.

## What does it do?
It fetches transactions that need review from [Monarch](https://www.monarch.com/), fetches ride data from Uber and delivery data from Uber Eats, and matches based on time and cost in an easily reviewable UI. It also creates suggested notes as shorthand of what the transaction was.
<img width="1430" height="976" alt="Screenshot 2025-10-19 at 9 51 06 AM" src="https://github.com/user-attachments/assets/4a3f2572-7f4c-4b64-9d7b-a3a219ac365d" />

Configurable with not just marking the transaction as reviewed with 'Accept', but marking it with a user-selectable tag from your Monarch list.
<img width="1194" height="934" alt="Screenshot 2025-10-19 at 9 27 47 AM" src="https://github.com/user-attachments/assets/60de3bac-254a-4667-910d-e9f11eab9497" />

Additionally allows configuring shorthand of location names, enabling stuff like "my friends' house" in the Uber ride suggested notes.
<img width="1240" height="979" alt="Screenshot 2025-10-19 at 9 52 58 AM" src="https://github.com/user-attachments/assets/cd8acddb-748c-4073-93bb-a0db6efa5a60" />

## Installation

1. Download the latest release zip (`viceroy.zip`) from the [releases page](https://github.com/dado3212/viceroy-extension/releases)
2. Unzip the file
3. Open Chrome and navigate to `chrome://extensions`
4. Enable developer mode
5. Click "Load unpacked" and select the unzipped folder

## How does it work?

It hijacks the requests that Monarch/Uber make to their respective APIs, and uses their private APIs. When you first use it you'll need to log in to each site, though it will save the information for the future.
<img width="991" height="353" alt="Screenshot 2025-10-19 at 11 09 18 AM" src="https://github.com/user-attachments/assets/21f4cf8d-10de-4a7d-8b63-b3419c70c886" />

## Viceroy?
The Viceroy butterfly is a mimic of the Monarch butterfly. Given that this was an extension for Monarch, and also cribs heavily from the design language of the official Monarch Amazon extension (heck, the icon is both a 180° hue match and rotation), figured it was an apt name.

This project is fully independent from Monarch and not affiliated/endorsed by them, all logos/naming are theirs (or Ubers).

Thank y'all for using GraphQL 🦋❤️.

## How to Build
`nvm use v22.13.1` (you can probably use a different version, but this is what I was using)  
`npm i`  
`npm run build`

And then open Chrome and load the unpacked `dist` folder in `chrome://extensions`.
