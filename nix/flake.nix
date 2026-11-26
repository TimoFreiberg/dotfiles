{
  description = "Global CLI and development tools for Timo's dotfiles";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});

      releasesFile =
        if builtins.pathExists ./releases.lock.json then ./releases.lock.json else ./releases.json;
      releases = builtins.fromJSON (builtins.readFile releasesFile);

      jcwTargets = {
        aarch64-darwin = "aarch64-apple-darwin";
        x86_64-darwin = "x86_64-apple-darwin";
        aarch64-linux = "aarch64-unknown-linux-gnu";
        x86_64-linux = "x86_64-unknown-linux-gnu";
      };
    in
    {
      packages = forAllSystems (
        system: pkgs:
        let
          jcw = pkgs.stdenvNoCC.mkDerivation {
            pname = "jcw";
            version = releases.jcw.version;

            src = pkgs.fetchurl {
              url = "https://github.com/TimoFreiberg/jj-conflict-workspace/releases/download/v${releases.jcw.version}/jcw-v${releases.jcw.version}-${jcwTargets.${system}}.tar.gz";
              sha256 = releases.jcw.sha256.${system};
            };

            dontUnpack = true;

            nativeBuildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
              pkgs.autoPatchelfHook
            ];

            buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
              pkgs.stdenv.cc.cc.lib
            ];

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/bin"
              tar -xzf "$src" -C "$out/bin" jcw
              chmod 755 "$out/bin/jcw"
              runHook postInstall
            '';

            meta = {
              description = "CLI tool that offers coding agents a more convenient view on jj conflicts";
              homepage = "https://github.com/TimoFreiberg/jj-conflict-workspace";
              license = pkgs.lib.licenses.mit;
              mainProgram = "jcw";
            };
          };

          lavish-hub = pkgs.stdenvNoCC.mkDerivation {
            pname = "lavish-hub";
            version = releases."lavish-hub".version;

            src = pkgs.fetchurl {
              url = "https://github.com/TimoFreiberg/lavish-hub/releases/download/v${releases."lavish-hub".version}/lavish-hub.tgz";
              sha256 = releases."lavish-hub".sha256;
            };

            nativeBuildInputs = [ pkgs.makeWrapper ];

            dontConfigure = true;
            dontBuild = true;
            dontFixup = true;

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib/lavish-hub" "$out/bin"
              cp -r . "$out/lib/lavish-hub/"
              makeWrapper "${pkgs.nodejs}/bin/node" "$out/bin/lavish-hub" \
                --add-flags "$out/lib/lavish-hub/bin/lavish-hub"
              runHook postInstall
            '';

            meta = {
              description = "Workspace review hub for Lavish artifacts and jj diffs";
              homepage = "https://github.com/TimoFreiberg/lavish-hub";
              license = pkgs.lib.licenses.mit;
              mainProgram = "lavish-hub";
            };
          };

          lavish-axi = pkgs.buildNpmPackage {
            pname = "lavish-axi";
            version = (builtins.fromJSON (builtins.readFile ./lavish-axi/package.json)).version;
            src = ./lavish-axi;

            npmDepsHash = "sha256-Avn2nXfCvNOxttokkHN8JRpzXJ4TLIX9xFmnmDBdhYw=";
            npmFlags = [ "--ignore-scripts" ];
            dontNpmBuild = true;

            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib/lavish-axi" "$out/bin"
              cp -r package.json node_modules "$out/lib/lavish-axi/"
              makeWrapper "${pkgs.nodejs}/bin/node" "$out/bin/lavish-axi" \
                --add-flags "$out/lib/lavish-axi/node_modules/lavish-axi/dist/cli.mjs"
              runHook postInstall
            '';

            meta = {
              description = "Lavish CLI for interactive HTML artifacts";
              homepage = "https://github.com/kunchenguid/lavish-axi";
              mainProgram = "lavish-axi";
            };
          };
        in
        {
          inherit jcw lavish-hub lavish-axi;

          default = pkgs.buildEnv {
            name = "dotfiles-tools";
            paths = [
              pkgs.atuin
              pkgs.bat
              pkgs.bun
              pkgs.cargo-binstall
              pkgs.cargo-nextest
              pkgs.cargo-sweep
              pkgs.chezmoi
              pkgs.delta
              pkgs.direnv
              pkgs.eza
              pkgs.fd
              pkgs.fzf
              pkgs.gh
              pkgs.jq
              pkgs.jujutsu
              pkgs.just
              pkgs.neovim
              pkgs.nodejs
              pkgs.ripgrep
              pkgs.ripgrep-all
              pkgs.rustup
              pkgs.shellcheck
              pkgs.starship
              pkgs.tmux
              pkgs.tokei
              pkgs.uv
              pkgs.zoxide
              jcw
              lavish-hub
              lavish-axi
            ];
          };
        }
      );
    };
}
