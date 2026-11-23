# KeatHong GuardHouse

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

A Telegram Mini App that helps people in Keat Hong Camp find each other fast. You can split a food order, share a ride, get a game going, or anything else. Groups are short-lived and open right inside Telegram. There's nothing to install and no sign-up.

## Getting started

1. Open the bot in Telegram: **[@keat_hong_guard_house_bot](https://t.me/keat_hong_guard_house_bot)**.
2. Tap **Start**, then **Open App** (the button beside the message box).
3. That's it. Your Telegram name is your account.

## What you can do

### Find a group
- The **Groups** tab lists every open group you're allowed to see. The ones closing soonest are at the top.
- **Search** by group name, leader name, @username or group code.
- Got a code from a friend, like `MANGO427`? Type it into search and tap **Open group MANGO427**. This also works for link-only groups.
- Filter by category (🍱 Food, 🚗 Ride, 🎮 Gaming, ✨ Other). Switch to **My groups** to see the ones you're in.

### Join
Tap **Join**. The bot then DMs you a **Message leader** button so you can sort out the details. The leader also hears that you joined. When the group fills up, every member is told.

### Start a group
On the **Create** tab, pick a category, a name, a member cap and how long the group stays open. You can add notes or links too, such as a GrabFood cart link. You become the group's **leader**. Tap **Share** to send the invite link anywhere.

You can lead up to **3 active groups** at a time. This limit keeps the camp's notifications useful.

### Selective invites (tags)
In **Settings**, set your tags: Unit, Company, Platoon, Section and Role (Commander or Trooper). When you create a group, you can limit it to people who share some of your tags. For example, "only my Company" or "only my Platoon and Commanders".

- People without **all** of the chosen tags can't see, open or join the group. They also don't get notified about it.
- Spelling doesn't matter. "Alpha", "ALPHA " and "a-lpha" count as the same tag.

**Link only** groups never appear in the feed. People can join only through your link or code.

### Leader tools
Open your group to use these:
- **Message all members**: one message, and the bot DMs it to everyone (e.g. "Meet at the guardhouse 1830").
- **Remove** a member (tap twice to confirm). They get a DM saying they were removed.
- Change the **member cap** or switch between **Public** and **Link only**.
- **Cancel group**: every member gets a DM.

### Notifications
- Each time a public group you're allowed to see opens, the bot DMs you. This is on by default.
- Not into rides? Tap **🔕 Mute Ride alerts** right under that DM. You can also turn categories (or everything) off in **Settings**.

## Privacy

The app stores your Telegram id, first name, @username, the tags you set, your notification choices, and the groups you create or join. Groups are deleted 30 days after they close. Other members of your group see your name and @username so they can message you. No phone numbers are stored.

## FAQ

**I don't see a group my friend made.** It may be limited to tags you don't hold, or it may be link only. Ask for the code and type it into search.

**The Message button is missing.** That person has no Telegram @username. Ask them to set one in Telegram settings.

**Can I leave a group I lead?** No. Cancel it instead, and members will be told.
