## SpaceViewer 2.2.20

- **Cursor do Mouse Visível na Tela Virtual**: Corrigida a invisibilidade do cursor do mouse ao movê-lo para a tela virtual estendida (`HardwareCursor: false`). O Windows agora renderiza o cursor via software diretamente sobre o framebuffer do monitor virtual, tornando o ponteiro do mouse 100% visível, fluido e sincronizado em transmissões Moonlight e nas Smart TVs.
- **Sincronização do Driver MTT VDD**: Configuração aplicada diretamente em `vdd_settings.xml` e no script gerenciador de telas para garantir que toda ativação de monitor virtual exiba o cursor perfeitamente.
