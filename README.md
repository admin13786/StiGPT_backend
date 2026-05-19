# StiGPT Backend

NestJS backend for the StiGPT learning clone.

## Local Development

```bash
npm install
npm run start:dev
```

Default backend port inside the app is `21101`.

## Docker Deployment

The canonical Docker entrypoint lives in the frontend repository directory:

```bash
cd ../frontent
docker compose -p stigpt up -d --build
```

The compose stack exposes the backend on host port `32101` by default:

```text
http://localhost:32101/api/v1
```

## Verification

```bash
npm run build
npm test -- --runInBand
```

## Do Not Commit

- `.env`
- `dist/`
- `node_modules/`
- `logs/`
- `uploads/`
