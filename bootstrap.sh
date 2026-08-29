#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
nvm_version="v0.40.3"
node_version="22"
export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"

if [[ "${EUID}" -eq 0 ]]; then
	apt_command=(apt-get)
else
	apt_command=(sudo apt-get)
fi

"${apt_command[@]}" update
"${apt_command[@]}" install --yes make curl ca-certificates qt6-declarative-dev-tools kpackagetool6

if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
	curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${nvm_version}/install.sh" | METHOD=script bash
fi

# shellcheck source=/dev/null
. "${NVM_DIR}/nvm.sh"
nvm install "${node_version}"
nvm alias default "${node_version}"
nvm use "${node_version}"

cd "${script_dir}"
npm install