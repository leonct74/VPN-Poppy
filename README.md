# VPN-Poppy

A personal VPN **on the fly**, in your own AWS — an
[AgentsPoppy](https://agentspoppy.com) poppy.

- **One click, ~60 seconds:** a WireGuard endpoint in the AWS region you pick. Scan a QR
  with your phone, download a `.conf` for your laptop — unlimited devices.
- **A server nobody can enter — including you.** No SSH, no login, one silent UDP port.
  All keys are generated in the app on your machine.
- **More private than a VPN subscription:** websites see the endpoint's IP (fresh on
  every launch), your network sees only an encrypted tunnel, and **no VPN company exists
  to see your traffic at all**.
- **Pay cents, not $10/month:** ~$0.004/hour + data transfer, with a live cost meter in
  the app. Auto-tears-down after the hours you choose, or whenever you say.
- **Honest by design:** it won't unblock streaming (datacenter IPs are blocked) and we
  say so before AWS bills you a cent.

**Status: in development** (design complete — see [`DESIGN.md`](DESIGN.md) for the
architecture, the no-SSH key ceremony, and the roadmap). Free core; one optional premium
feature ("Shielded DNS": ad/tracker blocking on every connected device, $14.99/year)
sold through AgentsPoppy's in-app checkout.

## License

FSL-1.1-Apache-2.0 — see [LICENSE](LICENSE).
