# CarRent Docs (Simple Guide)

This folder is for quick setup and data import.

## What Is Inside

- `atlas-data/users.json` -> user data for MongoDB Atlas
- `atlas-data/cars.json` -> car data for MongoDB Atlas
- `atlas-data/images/users/*` -> downloaded user profile images
- `atlas-data/images/cars/*` -> downloaded car images
- `atlas-data/image-manifest.json` -> mapping of DB record IDs to local image files

Only `users` and `cars` are provided.  
Other collections (bookings, requests, offers, reviews) are created automatically when people use the website.

## 1. Install Project

Run from project root:

```bash
npm --prefix backend install
npm --prefix client install
```

## 2. Set Environment

Open `backend/.env` and make sure these values are set:

- `MONGO_URI`
- `JWT_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Use this format:

```env
MONGO_URI=mongodb+srv://<username>:<password>@<cluster-url>/car_rental?retryWrites=true&w=majority&appName=<appName>
JWT_SECRET=<long-random-secret>
CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>
```

### 2.1 How To Get `MONGO_URI` (MongoDB Atlas)

1. Go to `https://www.mongodb.com/cloud/atlas` and log in.
2. Open your project.
3. If you do not have a cluster, create one (free tier is enough for dev).
4. Open **Security -> Database Access**.
5. Create a database user (username + password). Save both.
6. Open **Security -> Network Access**.
7. Add your current IP address. For local testing you can also add `0.0.0.0/0` (less secure).
8. Open **Database -> Clusters**.
9. Click **Connect** on your cluster.
10. Choose **Drivers**.
11. Copy the connection string shown by Atlas.
12. Replace `<username>` with your DB username.
13. Replace `<password>` with your DB password.
14. Add database name after host as `/car_rental`.
15. Paste final string into `backend/.env` as `MONGO_URI`.

### 2.2 How To Create `JWT_SECRET`

1. Use any long random string (recommended length: 32+ characters).
2. Quick way in terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. Copy output and set it as `JWT_SECRET` in `backend/.env`.

### 2.3 How To Get Cloudinary Keys

1. Go to `https://cloudinary.com/` and log in.
2. Open your **Dashboard**.
3. Copy **Cloud name** and set it as `CLOUDINARY_CLOUD_NAME`.
4. Copy **API Key** and set it as `CLOUDINARY_API_KEY`.
5. Copy **API Secret** and set it as `CLOUDINARY_API_SECRET`.
6. Paste all 3 values into `backend/.env`.

### 2.4 After Updating `.env`

1. Save `backend/.env`.
2. Restart server:

```bash
npm run dev
```

## 3. Import Seed Data To Atlas (Users + Cars)

1. Open MongoDB Atlas.
2. Open database `car_rental`.
3. Create/open collection `users`.
4. Click **Import Data** and import `docs/atlas-data/users.json`.
5. Create/open collection `cars`.
6. Click **Import Data** and import `docs/atlas-data/cars.json`.

## 3.1 Important: If You Use Your Own Cloudinary Account

After importing `users.json` and `cars.json`, image URLs still point to the old Cloudinary account.

Use this simple process:

1. Keep these local folders as image source:
- `docs/atlas-data/images/users`
- `docs/atlas-data/images/cars`
2. Start website: `npm run dev`
3. Login as admin.
4. Go to **Owner -> Manage Cars** and update car image one by one (upload from `docs/atlas-data/images/cars`).
5. For users, each user can update profile photo from profile page (or admin can ask users to re-upload).

When re-upload is done, database image URL + `imagePublicId` will move to your own Cloudinary account automatically.

## 4. Run Website

From project root:

```bash
npm run dev
```

Open:

- `http://localhost:5173`

## 5. Daily Commands

- Full app (single port): `npm run dev`
- Backend only: `npm run dev:backend`
- Frontend only: `npm run dev:frontend`
- Build frontend: `npm run build`
- Run backend (prod mode): `npm run start`
- Move local Mongo data to Atlas: `npm --prefix backend run migrate:atlas`
- Move old local image paths to Cloudinary: `npm --prefix backend run migrate:images`

## Website Flow (Easy View)

### User Side

1. Register or login.
2. Complete profile if asked.
3. Browse cars and open car details.
4. Book car / send offer.
5. Check bookings in `My Bookings`.
6. Update profile and password.

### Admin Side (`/owner`)

1. Login as admin.
2. Manage cars (add, edit, hide, delete).
3. Manage booking requests and bookings.
4. Manage offers and reviews.
5. Manage users.

### Images Flow

1. Image is uploaded from frontend.
2. Backend uploads image to Cloudinary.
3. MongoDB stores only image URL + `imagePublicId`.
4. When image is updated, old Cloudinary image is deleted.
