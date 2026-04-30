FROM mcr.microsoft.com/devcontainers/typescript-node:22

RUN apt-get update && apt-get upgrade -y
RUN apt-get install -y zsh curl git jq

WORKDIR /workspaces
RUN chown -R node:node /workspaces
USER node

SHELL ["/usr/bin/zsh", "-c"]
