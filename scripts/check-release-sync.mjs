import { spawnSync } from 'node:child_process';

// release-it fetches the current branch's remote before this after:git:init hook.
const result = spawnSync('git', ['merge-base', '--is-ancestor', '@{upstream}', 'HEAD'], {
  encoding: 'utf8',
});
if (result.status !== 0) {
  console.error(
    result.status === 1
      ? '发布已终止：远程分支存在本地未同步的提交。请先拉取并合并或变基，再运行 npm run release。'
      : `发布前置检查失败，已终止发布：${result.error?.message || result.stderr}`,
  );
  process.exit(1);
}
