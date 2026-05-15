@echo off
echo [CampanhaPro] Iniciando atualizacao do GitHub...
echo [Build] Otimizando chunks e limpando configuracoes...
git add .
git commit -m "Arquitetura: Sincronizacao CamelCase, Otimizacao Vite e CI/CD Supabase"
git push origin main
echo [CampanhaPro] Atualizacao concluida com sucesso!
echo [Deploy] O Easypanel iniciara o build em instantes.
echo [Deploy] O GitHub Actions iniciara o deploy das Edge Functions.
echo.
echo [IMPORTANTE] Se encontrar erros de "column not found" no log,
echo execute o script SQL de correcao no Dashboard do Supabase.
echo.
pause
