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

      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        {
          pkgs,
          config,
          system,
          ...
        }:
        {
          _module.args.pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };

          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs
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

          checks = {
            devShell = config.devShells.default;
          };
        };
    };
}
