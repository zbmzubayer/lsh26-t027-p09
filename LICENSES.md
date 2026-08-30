# Licenses

This project is submitted for LSH26 (team LSH26-T027, problem P09). Everything
below is third-party work used under its own license; the original code in this
repository is the team's own.

## This repository

No license has been chosen for the team's own source. All rights reserved by the
authors pending a decision after the event.

## Runtime dependencies

| Package                  | Version | License      |
| ------------------------ | ------- | ------------ |
| @base-ui/react           | 1.7.0   | MIT          |
| @hookform/resolvers      | 5.9.1   | MIT          |
| @prisma/adapter-pg       | 7.10.0  | Apache-2.0   |
| @prisma/client           | 7.10.0  | Apache-2.0   |
| @shadcn/react            | 0.3.0   | MIT          |
| @tanstack/react-query    | 5.102.8 | MIT          |
| argon2                   | 0.45.1  | MIT          |
| class-variance-authority | 0.7.1   | Apache-2.0   |
| clsx                     | 2.1.1   | MIT          |
| cmdk                     | 1.1.1   | MIT          |
| date-fns                 | 4.4.0   | MIT          |
| dotenv                   | 17.4.2  | BSD-2-Clause |
| embla-carousel-react     | 8.6.0   | MIT          |
| input-otp                | 1.5.0   | MIT          |
| jose                     | 6.2.10  | MIT          |
| lucide-react             | 1.37.0  | ISC          |
| next                     | 16.3.3  | MIT          |
| next-themes              | 0.4.6   | MIT          |
| pg                       | 8.23.0  | MIT          |
| react                    | 19.2.8  | MIT          |
| react-day-picker         | 10.0.1  | MIT          |
| react-dom                | 19.2.8  | MIT          |
| react-hook-form          | 7.87.0  | MIT          |
| react-resizable-panels   | 4.12.3  | MIT          |
| recharts                 | 3.8.0   | MIT          |
| shadcn                   | 4.19.0  | MIT          |
| tailwind-merge           | 3.6.0   | MIT          |
| tw-animate-css           | 1.4.0   | MIT          |
| zod                      | 4.5.4   | MIT          |

## Development dependencies

| Package              | Version  | License           |
| -------------------- | -------- | ----------------- |
| @biomejs/biome       | 2.4.2    | MIT OR Apache-2.0 |
| @tailwindcss/postcss | 4.3.3    | MIT               |
| @types/node          | 20.19.43 | MIT               |
| @types/pg            | 8.23.1   | MIT               |
| @types/react         | 19.2.18  | MIT               |
| @types/react-dom     | 19.2.5   | MIT               |
| husky                | 9.1.7    | MIT               |
| lint-staged          | 17.4.1   | MIT               |
| prisma               | 7.10.0   | Apache-2.0        |
| tailwindcss          | 4.3.3    | MIT               |
| tsx                  | 4.23.13  | MIT               |
| typescript           | 5.9.3    | Apache-2.0        |

## Python (ml/)

The visit-prediction model in `ml/` runs on a separate Python toolchain,
installed on demand by `uv` from `ml/requirements.txt`. It is not bundled into
the deployed application.

| Package      | License      |
| ------------ | ------------ |
| numpy        | BSD-3-Clause |
| scikit-learn | BSD-3-Clause |
| fastapi      | MIT          |
| uvicorn      | BSD-3-Clause |

Transitive dependencies of the above are covered by their own licenses; see
`package-lock.json` and the installed distributions for the full tree.

## Data

The service cases (`src/data/case-pub-01.json`, `ml/cases.json`) are the
event-published fixtures for problem P09 plus records entered through the
application. They contain no real customer data.

## Tools

Claude Code (Anthropic) was used during development; see `ai_tools_used` in
`evaluation-manifest.json` for what it was used for and how the output was
verified.
