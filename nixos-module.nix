{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.n8n-nodes;
  allNodePackages = self.packages.${pkgs.stdenv.hostPlatform.system};

  enabledPackages = lib.filterAttrs (name: _: cfg.nodes.${name}.enable) allNodePackages;

  wrapNodePackage =
    name: package:
    pkgs.runCommand "${name}-with-n8n-runtime-peers"
      {
        pname = name;
        version = package.version or "1.0.0";
      }
      ''
        nodeDir="$out/lib/node_modules/${name}"
        mkdir -p "$nodeDir"
        cp -R ${package}/lib/node_modules/${name}/. "$nodeDir/"
        chmod -R u+w "$nodeDir"

        # Custom nodes declare n8n-workflow as a peer dependency.  Nix installs
        # n8n's workspace package outside the node package tree, so provide the
        # runtime peer where Node's module resolver expects it.
        mkdir -p "$nodeDir/node_modules"
        rm -rf "$nodeDir/node_modules/n8n-workflow"
        ln -s ${config.services.n8n.package}/lib/n8n/packages/workflow \
          "$nodeDir/node_modules/n8n-workflow"
      '';

  wrappedPackages = lib.mapAttrs wrapNodePackage enabledPackages;
in
{
  options.n8n-nodes = {
    enableAll = lib.mkEnableOption "all n8n community nodes from this flake";

    nodes = lib.mapAttrs (name: _: {
      enable = lib.mkEnableOption "the ${name} n8n community node";
    }) allNodePackages;

    extraNodes = lib.mkOption {
      type = lib.types.attrsOf lib.types.path;
      default = { };
      description = ''
        Additional n8n community node dist directories to expose under
        /var/lib/n8n/.n8n/custom/. Attribute names become directory names.
      '';
      example = lib.literalExpression ''
        {
          n8n-nodes-paperless = "''${pkgs.n8n-nodes-paperless}/lib/node_modules/n8n-nodes-paperless/dist";
        }
      '';
    };
  };

  config = lib.mkMerge [
    (lib.mkIf cfg.enableAll {
      n8n-nodes.nodes = lib.mapAttrs (_: _: { enable = true; }) allNodePackages;
    })

    (lib.mkIf (wrappedPackages != { } || cfg.extraNodes != { }) {
      systemd.services.n8n.preStart = lib.mkAfter ''
        mkdir -p /var/lib/n8n/.n8n/custom
        ${lib.concatStringsSep "\n" (
          lib.mapAttrsToList (
            name: package: "ln -sfn ${package}/lib/node_modules/${name}/dist /var/lib/n8n/.n8n/custom/${name}"
          ) wrappedPackages
        )}
        ${lib.concatStringsSep "\n" (
          lib.mapAttrsToList (name: path: "ln -sfn ${path} /var/lib/n8n/.n8n/custom/${name}") cfg.extraNodes
        )}
      '';
    })

    (lib.mkIf cfg.nodes."n8n-nodes-ytdlp".enable {
      systemd.services.n8n = {
        environment.YT_DLP_PATH = lib.getExe (pkgs.yt-dlp.override { ffmpeg-headless = pkgs.ffmpeg; });
        path = [
          pkgs.ffmpeg
          (pkgs.yt-dlp.override { ffmpeg-headless = pkgs.ffmpeg; })
        ];
      };
    })
  ];
}
