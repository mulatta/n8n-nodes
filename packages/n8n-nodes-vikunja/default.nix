{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
}:

buildNpmPackage (finalAttrs: {
  pname = "n8n-nodes-vikunja";
  version = "0.4.1";

  src = fetchFromGitHub {
    owner = "go-vikunja";
    repo = "n8n-vikunja-nodes";
    rev = "fac70c5bed2eaede3df9bb2e7ef3d7d309524cde";
    hash = "sha256-gFlUlimQ6MULr+L9mfqbUpDMhjyRIdppwixTOhYEt1E=";
  };

  npmDepsHash = "sha256-wWy+jBA7n70QT4gTNQGLUGyTEAJx4DyU4U+X5lM2dZo=";

  npmFlags = [
    "--ignore-scripts"
    "--legacy-peer-deps"
  ];

  installPhase = ''
    runHook preInstall
    npm prune --omit=dev --ignore-scripts --legacy-peer-deps
    mkdir -p $out/lib/node_modules/${finalAttrs.pname}
    cp -r dist package.json node_modules $out/lib/node_modules/${finalAttrs.pname}/
    runHook postInstall
  '';

  meta = {
    description = "n8n community node for Vikunja workflows";
    homepage = "https://github.com/go-vikunja/n8n-vikunja-nodes";
    license = lib.licenses.mit;
  };
})
