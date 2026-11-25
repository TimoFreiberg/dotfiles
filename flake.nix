{
  description = "Global CLI and development tools for Timo's dotfiles";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    jcw = {
      url = "github:TimoFreiberg/jj-conflict-workspace";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    lavish-hub = {
      url = "github:TimoFreiberg/lavish-hub";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      jcw,
      lavish-hub,
    }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (
        system: pkgs:
        let
          lavish-axi = pkgs.buildNpmPackage {
            pname = "lavish-axi";
            version = (builtins.fromJSON (builtins.readFile ./nix/lavish-axi/package.json)).version;
            src = ./nix/lavish-axi;

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
          inherit lavish-axi;

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
              jcw.packages.${system}.default
              lavish-hub.packages.${system}.default
              lavish-axi
            ];
          };
        }
      );
    };
}
