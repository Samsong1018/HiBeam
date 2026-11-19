# KiroweenHackathon

## Prompt and Categories

**Resurrection:**
Bring your favorite dead technology back to life. Reimagine obsolete tech with today’s innovations or solving tomorrow’s problems.

**Frankenstein:** 
Stitch together a chimera of technologies into one app. Bring together seemingly incompatible elements to build something unexpectedly powerful.

**Skeleton Crew:** 
Build a skeleton code template lean enough to be clear but flexible enough to support various use cases. Show us its versatility with two distinct applications from your foundation.

**Costume Contest:** 
Build any app but show us a haunting user interface that’s polished and unforgettable. Bring in spooky design elements that enhance your app’s function.

## Project

### Dashboard Generator | Skeleton Crew

A dashboard Generator that takes in multiple sources and allows you to create graphs, statistics, and numbers in a formatted manner.
## Environment Variables
Set these in `.env` (never commit real values):
- `SOURCE_KEY_SECRET` (required): 32 random bytes, base64-encoded. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `APP_BASE_URL` (optional): public base URL of the app, e.g. `http://localhost:3000`.

## Database migrations
If your database was created from an older `schema.sql`, run any files in `Web/backend/db/migrations/` you haven't applied yet, in order:
```
mysql -u <user> -p <database> < Web/backend/db/migrations/001_dashboard_visibility.sql
```



# Web Layout

## Pages

### Login

#### Input:
- Username/Email
- Password

### Sign up/Create account

#### Input:
- Username
- Email
- Password

### Homepage

#### Retrieve:
- Saved dashboards as JSON
- User data

### View dashboard

#### Input:
- Public/private view
- Share

#### Retrieve:
- Dashboard data/layout

### Edit dashboard

#### Retrieve:
- Dashboard data
- Templates (premade?, generated?)

#### Input:
- New objects
- New data

### Profile

#### Retrieve:
- User data

#### Input:
- Changes to user data
