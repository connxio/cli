bump version:
    npm pkg set version={{version}} --prefix packages/cli
    git add packages/cli/package.json
    git commit -m "chore: bump version to {{version}}"
    git tag v{{version}}
    @echo ""
    @echo "Created commit and tag v{{version}}."
    @read -p "Push now? [Y/n] " confirm && [ "$$confirm" != "n" ] && git push && git push origin v{{version}} || echo "Run when ready: git push && git push origin v{{version}}"
