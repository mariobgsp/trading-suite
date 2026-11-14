# iOS app from a Linux laptop

**Question:** Can you build an iOS app and install it on a physical iPhone over USB from Fedora 45, with no Mac?

**Short answer:** You can *install* and even *re-sign* an existing `.ipa` on Linux, but you cannot *build* one, because Apple ships the iOS SDK only inside Xcode, and Xcode 27 — the current release, carrying the iOS 27 SDK — runs only on a Mac ([Apple](https://developer.apple.com/xcode/)). Every non-jailbroken install also needs an Apple-issued certificate plus a provisioning profile containing your device, and those are obtainable on Linux — free via an Apple ID + anisette server, paid via the App Store Connect API — but the compile step is the wall. For this repo the sane answer is a PWA added to the Home Screen today, and a Mac/CI build only if you genuinely need native.

## 1. Signing and installation path

| Requirement | What Apple requires | Linux? |
| --- | --- | --- |
| Signing identity | Apple-issued certificate ("Apple Development") + its private key, used to CMS-sign the Mach-O | Yes (obtainable via Apple ID flow or ASC API) |
| Provisioning profile | Apple-signed plist binding App ID + certificate + device UDIDs, embedded in the bundle | Yes |
| Registered UDID | Required for ad hoc; development profiles include the device | Yes (`pymobiledevice3` reads it) |
| Developer Mode | iOS 16+: Settings → Privacy & Security → Developer Mode, restart + passcode | Yes, on-device |
| Trust this developer | Settings → General → VPN & Device Management → Trust, needs internet to `ppq.apple.com` | Yes, on-device |

Apple on Developer Mode: it "protects people from inadvertently installing potentially harmful software", does not affect App Store or TestFlight installs, and covers "building and running an app from Xcode, or installing an `.ipa` file" ([Apple](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)). Note the same page: "Developer Mode only appears in Settings if you initiate pairing or if you previously paired the device to a Mac."

Trust step, verbatim: tap Settings → General → VPN & Device Management → the developer name → Trust, and "In iOS 18, iPadOS 18, and visionOS 2 and later, tap 'Allow & Restart'". Verification needs connectivity to `https://ppq.apple.com` ([Apple Support 118254](https://support.apple.com/en-us/118254)).

Free Apple ID, Apple's own wording ([Developer account overview](https://developer.apple.com/help/account/basics/developer-account-overview/)):

- "You can register up to 10 App IDs, which expire after 7 days."
- "You can register up to 3 devices, which expire after 7 days."
- "You can install up to 3 apps per device. Provisioning profiles that enable apps to be installed on a device will expire 7 days from issuance. You'll need to rebuild and reinstall your app to your device after expiration."
- Free accounts "can't distribute apps"; capability availability "depend[s] on your program membership" ([Supported capabilities](https://developer.apple.com/help/account/reference/supported-capabilities-ios/)). Push notifications and most entitlements are not on the free tier — that last point is my reading of the matrix, whose checkmarks did not extract as text.

Paid, 99 USD/yr: no 7-day expiry (distribution profiles run 12 months — "Distribution provisioning profiles expire 12 months after they're issued", [Apple](https://support.apple.com/en-us/118254)), 100 devices "per product family, per membership year" for ad hoc ([Devices overview](https://developer.apple.com/help/account/devices/devices-overview/)), TestFlight with 100 internal / 10,000 external testers, and "Your build becomes unavailable for testers after 90 days" ([TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)).

## 2. The Linux toolchain

| Job | On Fedora, today | Evidence |
| --- | --- | --- |
| Build | **No.** iOS SDK + linker live in Xcode only; macOS SLA is "For use on Apple-branded Systems" | [Xcode listing](https://apps.apple.com/us/app/xcode/id497799835) |
| Install | **Yes.** `pymobiledevice3 apps install app.ipa` | [pymobiledevice3](https://doronz88.github.io/pymobiledevice3/latest/cli/apps/) |
| Sign / re-sign | **Yes**, given Apple-issued cert + profile | [zsign](https://github.com/zhlynn/zsign) |

**Building.** Xcode 27 carries the iOS 27 SDK and runs only on a Mac, so even a cheap used Intel Mac is not a shortcut. Theos does run on Linux ("Platform Linux … Targets supported: Linux, iOS", [Theos docs](https://theos.dev/docs/installation-linux)), but it compiles against Apple SDK headers you supply yourself — the repo ships an empty `sdks/` plus an `install-sdk` helper ([theos](https://github.com/theos/theos)) — and it targets jailbroken devices; its ldid/ad-hoc signatures are not accepted by stock iOS without a real Apple signature. I could not confirm any standalone swift.org "Swift SDK for iOS" that builds iOS apps without Xcode, so treat that claim as unverified.

**Installing.** `pymobiledevice3` talks to the phone through `usbmuxd` (packaged on Fedora, `dnf install usbmuxd`) ([installation](https://doronz88.github.io/pymobiledevice3/latest/installation/)). On iOS 17+ developer services sit behind an RSD tunnel, but "on iOS 17.4+ every command that needs one establishes a no-root, in-process userspace tunnel on its own"; only iOS 17.0–17.3 on Linux needs a privileged `remote tunneld` ([iOS 17+ tunnels](https://doronz88.github.io/pymobiledevice3/latest/guides/ios17-tunnels/)). Plain `apps install` goes through `installation_proxy`, so no tunnel or DDI is required. `ideviceinstaller` still does the same job, but its README was last updated 2023-07-20 ([repo](https://github.com/libimobiledevice/ideviceinstaller)) — use pymobiledevice3.

**Signing.** Getting the material is the interesting part. zsign "re-signs `.ipa` packages … with custom certificates and provisioning profiles — without Xcode, without macOS" (`zsign -k dev.p12 -m dev.prov`). For a paid account the App Store Connect API exposes `certificates` ("create new certificates, revoke existing certificates, and download certificates") and `profiles`, so a CSR generated with OpenSSL on Fedora can be turned into a cert + profile with no Apple hardware. For a free account there is no API: you need Apple ID authentication plus Anisette data, which is what `anisette-v3-server` provides "for SideStore … it can also be used with AltServer-Linux" ([repo](https://github.com/Dadoum/anisette-v3-server)). That is unofficial, and it is the piece that breaks when iOS point releases change.

## 3. The realistic options, ranked

| # | Option | Preconditions | Cost | What breaks | Works today from this laptop? |
| --- | --- | --- | --- | --- | --- |
| 1 | Free sideload (SideStore/pymobiledevice3) | An already-built `.ipa`, Apple ID, anisette server, Developer Mode, weekly re-sign | 0 | 7-day expiry, 3 apps, cert revocations, iOS regressions | Install yes; you have no `.ipa` to install |
| 2 | Paid account, ad hoc / TestFlight | A build from a Mac or macOS CI | 99 USD/yr | Ad hoc: 100 devices, UDID collection, 12-month profile. TestFlight: 90-day builds, beta review | Install yes, build no |
| 3 | Mac or macOS CI builds, Linux installs | Xcode 26+/27 on Apple silicon, or GitHub Actions macOS / MacStadium | ~$0.06/min on GitHub macOS (verify live rate) | Only complete path; slow feedback | Yes, as CI |
| 4 | PWA on the Home Screen | Served over LAN/VPN; HTTPS for push | 0 | No native APIs, no background sync, needs the server up | **Yes, now** |
| 5 | EU alternative marketplaces | Authorized operator (EU org; GBR/VC/audit, or a USD 1,000,000 stand-by letter of credit), EU users on iOS 17.4+ | High | Not available to a developer or user in Indonesia | No |

On (5): Apple authorizes marketplace operators only after meeting criteria including being "enrolled in the Apple Developer Program as an organization" and one of several financial proofs up to "a stand-by letter of credit in the amount of USD 1,000,000" ([Apple](https://developer.apple.com/support/alternative-app-marketplace-in-the-eu/)). The capability itself "is available to EU users on devices running a minimum of iOS 17.4". It gives a solo non-EU developer nothing.

On (4): iOS/iPadOS 16.4 added Web Push for Home Screen web apps; "A web app that has been added to the Home Screen can request permission to receive push notifications as long as that request is in response to direct user interaction" ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).

## 4. What it means for this project

The scanner is a FastAPI + React app. The valuable part is the API and the UI; nothing needs Core ML or background BLE.

| Path | Effort | Survives day 7 |
| --- | --- | --- |
| PWA: manifest + `display: standalone`, serve over Tailscale/LAN, Add to Home Screen | Hours | Yes, indefinitely |
| Capacitor/Swift shell, sideloaded free | Days, plus a Mac/CI to compile, then weekly re-sign | No |
| TestFlight | Days, plus CI and 99 USD/yr | Yes (90-day builds, re-upload) |

Smallest path this week: keep the FastAPI app where it is, add a web manifest and icons, expose it over Tailscale, Add to Home Screen. That is a real icon, full-screen, offline shell via a service worker, and optional push — no signing, no expiry. The one that survives past day 7 is the same PWA; the native shell only earns its keep if you need push without the home-screen requirement, background refresh, or App Store presence — and then the honest route is CI builds plus TestFlight, not a 7-day cert.

## Limits

- No iPhone is attached, so nothing below is verified on hardware.
- Whether a *Linux* pairing alone reveals the Developer Mode toggle is unconfirmed: Apple says the toggle appears once pairing is initiated, and `pymobiledevice3` pairing should satisfy that, but I did not test it.
- Free-account automation is unofficial and visibly fragile: SideStore's tracker has refresh/sign-in failures on iOS 26.4–26.5 ([#1222](https://github.com/SideStore/SideStore/issues/1222), [#1305](https://github.com/SideStore/SideStore/issues/1305)).
- GitHub's macOS per-minute figure came from the rate table but the macOS row did not survive text extraction; check [the live table](https://docs.github.com/en/billing/reference/actions-runner-pricing).
- iOS naming moved again: Xcode 27.2 ships the iOS 27.2 SDK, so the phone is likely on iOS 26.x or 27.x. The rules above (Developer Mode, 7-day free profiles, trust step) are the same on both.

## What to run on this laptop (untested)

```bash
sudo dnf install usbmuxd && systemctl status usbmuxd   # must be active
curl -LsSf https://astral.sh/uv/install.sh | sh
uv tool install --managed-python pymobiledevice3
pymobiledevice3 version
pymobiledevice3 usbmux list          # after plugging in + unlocking
pymobiledevice3 doctor              # when the list is empty
pymobiledevice3 apps install app.ipa
sudo "$(which pymobiledevice3)" remote tunneld   # only for iOS 17.0-17.3 / shared tunnels
# signing an existing ipa (needs gcc-c++, openssl-devel, pkg-config)
git clone https://github.com/zhlynn/zsign && cd zsign/build/linux && make
zsign -k dev.p12 -p '<pass>' -m dev.mobileprovision -o out.ipa in.ipa
```

**Bottom line:** Install and re-sign on Linux: yes. Build without a Mac: no — Apple's SDK and licence keep that on Apple hardware or macOS CI. Put the scanner on the phone this week as a PWA; spend the 99 USD and a CI runner only when you actually need a native binary.
