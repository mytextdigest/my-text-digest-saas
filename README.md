
## Getting Started


First, install packages

``` bash
npm install

```
Run, the below command to build SQLite binaries

``` bash
npm rebuild better-sqlite3 --runtime=electron --target=38.1.2 --disturl=https://electronjs.org/headers

```


Run the development server:

```bash
npm run dev
```

### Building packages step by step

1. Check the nextjs build

```bash
npm run build:next
```

2. Update the patch version:

```bash
npm version patch
```

3. Start building packages in github

```bash
git push & git push --tags
```

4. Track the build in github actions:

```bash
https://github.com/mytextdigest/mytextdigest/actions
```

5. Click on the latest build version, scroll down and download the latest one.
