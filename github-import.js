/*
 * GitHub repo import for the Linux terminal.
 *
 * - Token: optional personal access token, sealed with vault.js (AES-GCM, key in IndexedDB).
 * - List: GitHub REST API (api.github.com), with the token when one is saved.
 * - Clone: runs `git clone` inside the Linux root filesystem via LinuxShell.run.
 *   The token goes to git through an environment variable and a credential helper,
 *   never in the command line, so it does not show up in process listings.
 *
 * Projects live in /root/projects/<repo> inside the Linux root filesystem.
 */
(function (g) {
    'use strict';

    const TOKEN_KEY = 'hub_github_token_v1';
    const PROJECTS_DIR = '/root/projects';
    const NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
    const API = 'https://api.github.com';

    async function ensureVault() {
        if (!g.Vault) return false;
        if (!g.Vault.enabled()) {
            const store = g.Vault.indexedDbKeyStore();
            await g.Vault.init({ loadKey: () => store.loadKey(), saveKey: (k) => store.saveKey(k) });
        }
        return g.Vault.enabled();
    }

    async function saveToken(token) {
        const trimmed = (token || '').trim();
        if (!trimmed) {
            localStorage.removeItem(TOKEN_KEY);
            return;
        }
        if (!(await ensureVault())) {
            throw new Error('Secure storage is not available here, so the token was not saved');
        }
        localStorage.setItem(TOKEN_KEY, await g.Vault.seal(trimmed));
    }

    async function loadToken() {
        const sealed = localStorage.getItem(TOKEN_KEY);
        if (!sealed) return '';
        if (!(await ensureVault())) return '';
        return g.Vault.open(sealed);
    }

    async function hasToken() {
        return !!localStorage.getItem(TOKEN_KEY);
    }

    function headers(token) {
        const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
        if (token) h.Authorization = 'Bearer ' + token;
        return h;
    }

    /** Lists repositories the token can see (owned, collaborator, organisation). */
    async function listRepos(token) {
        if (!token) {
            throw new Error('Add a GitHub token to list your repositories. Public repos can still be cloned by name.');
        }
        const repos = [];
        for (let page = 1; page <= 10; page++) {
            const url = API + '/user/repos?per_page=100&sort=pushed&page=' + page
                + '&affiliation=owner,collaborator,organization_member';
            const res = await fetch(url, { headers: headers(token) });
            if (res.status === 401) throw new Error('GitHub rejected the token (401). Check that it is valid and not expired.');
            if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status + ' while listing repositories');
            const batch = await res.json();
            for (const r of batch) {
                repos.push({
                    fullName: r.full_name,
                    private: !!r.private,
                    description: r.description || '',
                    defaultBranch: r.default_branch,
                    pushedAt: r.pushed_at,
                });
            }
            if (batch.length < 100) break;
        }
        return repos;
    }

    function repoDirName(fullName) {
        return fullName.split('/')[1];
    }

    function assertName(fullName) {
        if (!NAME_RE.test(fullName)) throw new Error('Enter the repository as owner/name');
    }

    /** Installs git inside the root filesystem if it is missing. */
    async function ensureGit(LS) {
        const res = await LS.run({
            command: 'command -v git >/dev/null 2>&1 || apk add --no-cache git',
            timeoutSec: 900,
        });
        if (res.code !== 0) throw new Error('Installing git failed:\n' + tail(res.output));
    }

    /**
     * Clones owner/name into /root/projects/name. If the directory already exists it is
     * left alone and the existing path is returned.
     */
    async function cloneRepo(LS, fullName, token, onStage) {
        assertName(fullName);
        const dir = PROJECTS_DIR + '/' + repoDirName(fullName);
        onStage && onStage('Checking git');
        await ensureGit(LS);
        onStage && onStage('Cloning ' + fullName);
        const helper = "!f() { echo username=x-access-token; echo \"password=$GH_TOKEN\"; }; f";
        const command = 'mkdir -p ' + PROJECTS_DIR + ' && '
            + 'if [ -d ' + dir + ' ]; then echo "already cloned: ' + dir + '"; else '
            + "git -c credential.helper='" + helper + "' clone https://github.com/" + fullName + '.git ' + dir
            + '; fi';
        const res = await LS.run({
            command,
            timeoutSec: 1800,
            env: { GH_TOKEN: token || '', GIT_TERMINAL_PROMPT: '0' },
        });
        if (res.timedOut) throw new Error('Clone timed out');
        if (res.code !== 0) throw new Error('Clone failed:\n' + tail(res.output));
        return dir;
    }

    /** Names of the project directories under /root/projects. */
    async function listProjects(LS) {
        const res = await LS.run({ command: 'ls -1 ' + PROJECTS_DIR + ' 2>/dev/null || true', timeoutSec: 30 });
        return res.output.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }

    function tail(text, lines = 12) {
        const parts = String(text || '').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
        return parts.slice(-lines).join('\n') || '(no output)';
    }

    g.GitHubImport = {
        saveToken, loadToken, hasToken, listRepos, cloneRepo, listProjects,
        PROJECTS_DIR, isValidName: (n) => NAME_RE.test(n),
    };
})(window);
