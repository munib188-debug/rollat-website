# Guest Roll — Invite Playbook

How to invite other Solana projects to participate in the $ROLLAT Guest Roll.
Goal: get 10 hand-picked communities to accept per cycle, with high response rate.

---

## 1. The headline — way stronger than "you are invited"

Generic invites get ignored. Personalization + scarcity makes projects actually open the DM.

| Tier | Copy | Why |
|---|---|---|
| 🔥 Best | **"$BONK, you're up."** | Personalized, short, intriguing |
| Good | **"10 communities. 1 winner. You're one of the 10."** | Stakes + flattery |
| Good | **"Invite-only · Guest Roll #1"** | Scarcity + sense of curation |
| Decent | **"Your coin. Our wheel."** | Clean, on-brand |

Always personalize with their ticker — even a templated DM with `$TICKER` filled in feels 10× more real than "Hey project!"

---

## 2. The body — what to say after the headline

The card body should answer 3 things in **5 seconds**: *What is this? What do I win? What do I do?*

```
$ROLLAT is hosting 10 hand-picked Solana communities for one
live spin. The wheel picks 1 winner — that community gets
a DexScreener boost (24h, ~$300 value).

You're spot 4 of 10.
Spin date: Nov 12 · 18:00 UTC
Watch live: rollat.vercel.app/#guest-roll

To accept: reply with your logo (PNG) + community link.
That's it. No cost. No catch.
```

Lines doing real work:
- **"Hand-picked"** — flatters them
- **"Spot 4 of 10"** — scarcity + "the train is leaving"
- **Concrete prize value** ("$300") — beats "DexScreener boost" alone
- **"No cost. No catch."** — kills the scam suspicion that always shows up
- **Dead-simple ask** — logo + link, nothing else

---

## 3. Card design upgrades

Black card with $ROLLAT logo top-left is a solid base. Add:

- **Top-left**: $ROLLAT logo + "GUEST ROLL" wordmark
- **Top-right**: round number badge ("CYCLE #1 · INVITE 04/10")
- **Center**: small SVG preview of the 10-slice purple wheel — shows what they're joining
- **Their slot highlighted** with their ticker placeholder (`$XXXX`) glowing
- **Bottom**: prize value, date, RSVP CTA
- **Bottom-right**: QR code linking to public invite page
- **Footer**: CA + socials in small mono

**Sizes:**
- 1200×675 (16:9) for X previews
- 1080×1080 (square) for Telegram

Use the Guest Roll's purple `#A855F7` so cards feel like "the wheel sent you a letter."

---

## 4. Add a public `/guest-invite` landing page

Right now invites have no "tell me more" link. A tiny page does the heavy lifting:

**Sections:**
1. **Hero**: "You've been invited to the $ROLLAT Guest Roll." (auto-fill ticker from URL: `/guest-invite?t=BONK`)
2. **The pitch**: 3 bullets — free exposure, real prize, your community watches live
3. **How it works** (4 steps)
4. **The prize**: DexScreener boost photo + value
5. **Past winners** (once 1+ rounds done — social proof)
6. **The form**: name, ticker, logo URL, community link → submits straight into the admin queue
7. **FAQ**:
   - "Is there a catch?"
   - "What does my community do?"
   - "Can we promote it on our side?"

This single page will **double accept rate** because most projects say no due to ambiguity, not the offer itself.

---

## 5. The "what's in it for them" pitch (lead with this)

Reframe everything around the receiving project's win, not ours:

- **Your community gets a free moment.** They watch the spin live, cheer, screenshot — free content for your TG/X.
- **One of you wins a DexScreener boost.** Even at 1/10 odds, expected value is positive.
- **All 10 projects get cross-promo.** We tag every community in lineup + winner posts on X.
- **Zero financial cost.** No buy-in, no token swap, no commitment.
- **Co-marketing built in.** We'll quote-tweet your acceptance announcement.

---

## 6. Distribution strategy

| Channel | How | Conversion |
|---|---|---|
| **Public X post tagging all 10** | "We've picked our first 10. @bonk @pepe …" | High — peer pressure ("everyone else accepted") |
| **DM with personalized card** | Image + 2-line message | Medium — most replies within 24h |
| **Reply to their pinned post** | Public, visible to their community | Low–Medium but creates buzz |
| **Their TG announcement chat** | Only if it allows external messages | Hit-or-miss |

**Best play**: public X announcement *first* with all 10 tagged + cards visible, then DM each individually. Public post creates social proof; DM closes.

---

## 7. Drop-in DM template

```
gm $BONK 👋

We're $ROLLAT — Solana's daily roulette. Hold the token,
get auto-entered, one wallet wins the SOL pot every 24h.

We're launching Guest Roll: 10 hand-picked communities,
one live spin, winner gets a DexScreener boost (~$300, 24h).

You're spot 4 of 10. No cost, no catch.

Live: rollat.vercel.app/#guest-roll
Spins: Nov 12 · 18:00 UTC

To accept: reply with logo (PNG) + community link.
We'll do the rest. Will quote-tweet your acceptance 💜

CA: 6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump
```

---

## 8. Things that quietly kill response rate

- ❌ Generic "Hey project!" — feels like spam
- ❌ Asking them to *do* anything beyond send 2 things
- ❌ No deadline — always include the spin date
- ❌ No proof of legitimacy — always include CA + live site link
- ❌ Long paragraphs — DMs get skimmed in 3 seconds
- ❌ Demanding they promote us back (offer it, don't require it)

---

## 9. Optional power-ups

- **Round-robin invites**: keep a pool of 30+ projects, rotate 10 per cycle so more communities stay warm.
- **"Bring a friend" referral**: any participant project can recommend the next round's lineup — they feel like curators.
- **Winner reveal video**: 30-second loop of the wheel spinning + winner highlight — perfect quote-tweet asset.
- **Loser consolation**: send all 9 non-winners a small "Thanks for spinning with us" graphic they can share — keeps relations warm for next round.

---

## 10. Build queue (next concrete steps)

- [ ] Design the invite card template (Figma or Canva, 2 sizes: 1200×675 and 1080×1080)
- [ ] Build `/guest-invite` landing page with auto-filled ticker from URL param
- [ ] Add a public submission form (POST → admin queue)
- [ ] Draft the public "10 communities" X announcement post
- [ ] Build a "winner reveal" 30s video template
