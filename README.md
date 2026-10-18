# Yaari: MERN version

Pehle **START-HERE.md** padho (laptop par chalana, GitHub upload, Render live).
Bugs, tests ke asli natije aur jo baaki hai: **AUDIT-REPORT.md**.

Structure: `server/` (Express + MongoDB), `client/` (React + Vite), user site `/`, admin `/admin`.
Server ke routes: `/api/auth`, `/api/me`, `/api/files`, `/api/companions`, `/api/bookings`, `/api/payments`, `/api/safety`, `/api/admin`, `/api/settings`.
Timers (har ghante): auto-release, bina jawab wali booking ka refund, unpaid booking expire, repair. Har minute: SOS email dobara bhejna.
