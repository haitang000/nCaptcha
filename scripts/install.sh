#!/usr/bin/env bash
# 在 Linux 服务器上从 GitHub 安装独立服务。已有部署不会被覆盖。
set -Eeuo pipefail

usage() {
  cat <<'EOF'
用法：sudo bash scripts/install.sh

可选环境变量：
  CAPTCHA_ALLOWED_ORIGINS  允许的浏览器来源，多个来源以逗号分隔。
                           例如 https://example.com,https://www.example.com

需要 Linux、可用的 Docker 和网络连接。安装目录为 /opt/ncaptcha，
配置文件为 /opt/ncaptcha.env，容器名为 ncaptcha。
脚本只执行首次安装；已存在同名目录、配置或容器时会退出。
EOF
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then usage; exit 0; fi
if (( $# != 0 )); then usage >&2; exit 2; fi

fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
stage='检查环境'
trap 'printf "安装在“%s”阶段失败。请查看上面的错误；已创建的文件或容器不会自动删除。\n" "$stage" >&2' ERR

[[ $(uname -s) == Linux ]] || fail '此脚本仅支持 Linux。'
[[ $(id -u) == 0 ]] || fail '请以 root 身份运行，例如 sudo bash scripts/install.sh。'
command -v docker >/dev/null 2>&1 || fail '未找到 Docker，请先安装并启动 Docker。'
docker info >/dev/null 2>&1 || fail 'Docker 守护进程不可用，请先启动 Docker。'

directory=/opt/ncaptcha
env_file=/opt/ncaptcha.env
container=ncaptcha
node_image=node:22-bookworm-slim
origins=${CAPTCHA_ALLOWED_ORIGINS:-}
[[ $origins != *$'\n'* && $origins != *$'\r'* ]] || fail 'CAPTCHA_ALLOWED_ORIGINS 不能包含换行。'
[[ ! -e $directory && ! -L $directory ]] || fail "$directory 已存在，不会覆盖。"
[[ ! -e $env_file && ! -L $env_file ]] || fail "$env_file 已存在，不会覆盖。"
if docker container inspect "$container" >/dev/null 2>&1; then
  fail "容器 $container 已存在，不会覆盖。"
fi

stage='从 GitHub 克隆代码'
mkdir -p /opt
docker run --rm -v /opt:/git alpine/git clone --branch main \
  https://github.com/haitang000/nCaptcha.git /git/ncaptcha

stage='构建客户端'
docker run --rm -v "$directory:/app" -w /app "$node_image" \
  sh -c 'npm ci --include=dev && npm run build'

stage='生成配置'
secret=$(docker run --rm "$node_image" \
  node -p "require('node:crypto').randomBytes(32).toString('hex')")
[[ $secret =~ ^[0-9a-f]{64}$ ]] || fail '生成密钥失败。'
umask 077
# noclobber 防止在检查之后覆盖其他进程创建的配置文件。
set -o noclobber
cat > "$env_file" <<EOF
HOST=127.0.0.1
PORT=8787
CAPTCHA_SECRET=$secret
CAPTCHA_ALLOWED_ORIGINS=$origins
CAPTCHA_TRUSTED_PROXIES=
CAPTCHA_MODE=strict
EOF
set +o noclobber
unset secret

stage='启动服务'
docker run -d --name "$container" --restart unless-stopped --network host \
  --env-file "$env_file" -v "$directory:/app:ro" -w /app \
  "$node_image" node src/server.js >/dev/null

stage='检查服务'
healthy=false
for ((attempt=1; attempt<=20; attempt++)); do
  if docker logs "$container" 2>&1 | grep -Fq 'CAPTCHA 服务已启动：http://127.0.0.1:8787' && \
    docker exec "$container" node -e \
    "fetch('http://127.0.0.1:8787/health').then(async r => { const b = await r.json(); if (!r.ok || b.ok !== true) process.exit(1); }).catch(() => process.exit(1))" \
    >/dev/null 2>&1; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ $healthy != true ]]; then
  docker logs "$container" >&2 || true
  fail '健康检查失败，请检查上面的容器日志。'
fi

cat <<EOF
安装完成：
  代码目录：$directory
  配置文件：$env_file（仅 root 可读）
  健康检查：http://127.0.0.1:8787/health
  容器日志：docker logs $container

服务仅监听本机。公网接入需自行配置 HTTPS 反向代理、浏览器来源白名单，
并按 README 的“生产加固与会话绑定”配置私有题库与业务意图凭据。
配置变更后需要重建容器；请参阅 README。
EOF
