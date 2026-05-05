{
  description = "n8n custom nodes";

  inputs = {
    # keep-sorted start
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";
    flake-parts.url = "github:hercules-ci/flake-parts";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    # keep-sorted end
  };

  outputs =
    inputs@{
      flake-parts,
      treefmt-nix,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        treefmt-nix.flakeModule
      ];

      flake.nixosModules.default = inputs.nixpkgs.lib.modules.importApply ./nixos-module.nix {
        inherit (inputs) self;
      };

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        {
          pkgs,
          lib,
          config,
          system,
          ...
        }:
        let
          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };

          mkN8nNode =
            {
              pname,
              description,
              nativeCheckInputs ? [ ],
              jestArgs ? "--testPathPatterns='packages/${pname}/'",
            }:
            pkgs.buildNpmPackage {
              inherit pname;
              version = "1.0.0";

              src = lib.fileset.toSource {
                root = ./.;
                fileset = lib.fileset.unions [
                  ./tsconfig.base.json
                  ./tsconfig.json
                  ./jest.config.js
                  ./test
                  ./package.json
                  ./package-lock.json
                  (./. + "/packages/${pname}")
                ];
              };

              inherit npmDeps nativeCheckInputs;
              inherit (pkgs.importNpmLock) npmConfigHook;

              makeCacheWritable = true;
              npmFlags = [
                "--ignore-scripts"
                "--legacy-peer-deps"
              ];

              buildPhase = ''
                runHook preBuild
                npm run build --workspace=packages/${pname}
                runHook postBuild
              '';

              doCheck = true;
              checkPhase = ''
                runHook preCheck
                npx jest ${jestArgs}
                runHook postCheck
              '';

              installPhase = ''
                runHook preInstall

                npm prune --omit=dev --legacy-peer-deps

                mkdir -p $out/lib/node_modules/${pname}
                cp -r packages/${pname}/dist packages/${pname}/package.json node_modules $out/lib/node_modules/${pname}/

                find $out/lib/node_modules/${pname}/node_modules \
                  -maxdepth 1 -type l -xtype l -delete

                runHook postInstall
              '';

              meta = {
                inherit description;
                license = lib.licenses.mit;
              };
            };
        in
        {
          _module.args.pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };

          packages = {
            n8n-nodes-caldav = mkN8nNode {
              pname = "n8n-nodes-caldav";
              description = "n8n node for CalDAV integration";
              jestArgs = "--config packages/n8n-nodes-caldav/jest.config.js";
              nativeCheckInputs = [
                pkgs.apacheHttpd
                pkgs.radicale
              ];
            };
            n8n-nodes-github-notifications = mkN8nNode {
              pname = "n8n-nodes-github-notifications";
              description = "n8n node to list GitHub notifications";
            };
            n8n-nodes-imap = mkN8nNode {
              pname = "n8n-nodes-imap";
              description = "n8n node to interact with IMAP mailboxes and create email drafts";
            };
            n8n-nodes-jmap = mkN8nNode {
              pname = "n8n-nodes-jmap";
              description = "n8n node to interact with JMAP mailboxes and email objects";
            };
            n8n-nodes-nostr = mkN8nNode {
              pname = "n8n-nodes-nostr";
              description = "n8n node to send encrypted DMs via Nostr using NIP-59 Gift Wrap";
            };
            n8n-nodes-opencrow = mkN8nNode {
              pname = "n8n-nodes-opencrow";
              description = "n8n node to send trigger messages to OpenCrow";
            };
          };

          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              apacheHttpd
              nodejs
              radicale
            ];

            shellHook = ''
              echo "n8n custom nodes development environment"
            '';
          };

          treefmt = {
            projectRootFile = "flake.nix";
            programs = {
              deadnix.enable = true;
              keep-sorted.enable = true;
              nixfmt.enable = true;
              prettier.enable = true;
              statix.enable = true;
            };
            settings.formatter.prettier.excludes = [
              "flake.lock"
              "package-lock.json"
            ];
          };

          checks = config.packages // {
            devShell = config.devShells.default;
          };
        };
    };
}
