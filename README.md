# Tilt Racer

Tilt Racer turns a phone into a real-time motion controller for a browser-based racing game. Open the game on a laptop, scan its room QR code with one or more phones, enable motion access, and tilt to steer. Shaking or tapping jumps; holding Boost or Brake changes your speed.

## Run it locally

You need Node.js 20 or newer.

```sh
npm install
npm start
```

Open `http://localhost:3000` on the laptop. The QR code uses the laptop's detected local IPv4 address when the game is opened through `localhost`. Open port `3000` in the laptop's firewall if the phone cannot connect. Both devices must be on the same Wi-Fi.

Motion and orientation sensors require a secure context in current mobile browsers. For a real phone demo, serve the app over HTTPS (for example, behind a TLS-terminating reverse proxy), set `PUBLIC_URL` to its externally reachable HTTPS address, and scan the QR code from that page:

```powershell
$env:PUBLIC_URL = "https://race.example.com"
npm start
```

Alternatively set `LAN_HOST` to the laptop's LAN IP if automatic address detection selects the wrong network interface. A plain `http://localhost` page can be used to inspect the game on the laptop, but phone motion access is not guaranteed over an insecure HTTP connection.

For phone testing without configuring a domain or reverse proxy, install Cloudflare Tunnel and run the optional HTTPS mode:

```powershell
winget install --id Cloudflare.cloudflared
npm run start:phone
```

Wait for the `Phone HTTPS URL` in the terminal, then open `http://localhost:3000` on the laptop and scan its QR code. Keep the server running while playing. The temporary HTTPS tunnel makes the game reachable from the public internet for its duration.

## Pair and play

1. Open the game page on the laptop. It creates a six-character room and displays a QR code.
2. Scan the QR code or open the displayed address on the phone. Entering the room code is automatic from the QR link. If you cannot scan, open `/?mode=controller` on the same network and type the code shown on the laptop.
3. Tap **Enable motion controls** and allow access when asked. Hold the phone upright in portrait and tap **Set neutral position**.
4. Tilt to steer, shake or tap **Jump** to jump, and press and hold **Boost** or **Brake**.
5. Leave the phone screen open during the race. The room supports up to eight phones; each phone steers its own racer.

If permission was denied, allow motion access in the browser's site settings and reload the controller page. The controller displays its WebSocket round-trip time; the laptop displays the current player count and its own round-trip time.

## Tech stack

- **Phone controller and browser game:** vanilla JavaScript modules, Canvas 2D, responsive HTML/CSS, and a lightweight installable PWA shell. No frontend framework or bundler is required.
- **Pairing and realtime service:** Node.js HTTP server and WebSockets (`ws`); QR codes are generated locally with `qrcode`. Rooms are short, randomly allocated codes shared by the QR URL.
- **Sensors:** the browser's `DeviceOrientationEvent` supplies tilt; `DeviceMotionEvent` supplies shake detection. Calibration stores a neutral gamma angle, and a low-pass filter smooths steering.
- **Bonus controls:** touch buttons for jump, boost, and brake; vibration on jump; up to eight independent racers; and client-measured WebSocket round-trip latency.

## Latency and reconnect behavior

The phone samples tilt as browser motion events arrive and sends the latest compact control state over the room's WebSocket every 33 ms (up to 30 updates per second). This sends current state rather than queueing stale sensor readings. The server validates/clamps control values and forwards them directly to the other room participants. Browser animation uses `requestAnimationFrame`; client-to-server-to-client ping/pong reports round-trip time. There is no polling on the control path.

If the connection drops, the client reconnects with exponential backoff, rejoins the same room, and resumes sending the most recent controls. The server also pings idle connections and removes abandoned, empty rooms after 30 minutes. The latency shown is round-trip network time, not a one-way sensor-to-display measurement.

## Installability, APK, and hosting

The controller is a progressive web app and can be installed from a compatible mobile browser when hosted over HTTPS. This repository does **not** include an Android APK: packaging a signed native APK requires an Android build toolchain and signing credentials, neither of which is provided by this project. No hosted build or public GitHub URL is published by this local checkout; it must be pushed to a GitHub repository and deployed to create shareable links.

## Demo recording

To record a real phone controlling the laptop, start the server on a machine reachable by both devices, open the HTTPS game URL on the laptop, scan its QR code on the phone, and record both screens while steering, jumping, and showing the latency readout. A physical phone/screen-recording session cannot be generated from this source checkout.

## Tests

```sh
npm test
```
