/* Dados do catálogo embutidos — evita bloqueio de fetch() ao abrir o index.html direto no navegador */
const FILMES_DATA = [
  {
    "id": "f001",
    "titulo": "Renuncia- O preço da verdade",
    "descricao": "importância de manter princípios firmes e a necessidade de escolhas difíceis (renúncias) para seguir a fé cristã diante das pressões da sociedade.",
    "tempo": "2H",
    "classificacao": "10 Anos",
    "capa": "https://img.youtube.com/vi/rrt_zOnKeMg/maxresdefault.jpg",
    "youtubeId": "rrt_zOnKeMg",
    "tags": [
      "Brasileiro",
      "Cristão",
      "família"
    ]
  },
  {
    "id": "f002",
    "titulo": "Sintel",
    "descricao": "Uma jovem solitária parte em uma jornada épica para encontrar o dragão bebê que criou e que foi levado dela. Uma aventura sombria e emocionante.",
    "tempo": "15 min",
    "classificacao": "12",
    "capa": "https://durian.blender.org/wp-content/uploads/2010/06/sintel_poster_bg.jpg",
    "youtubeId": "eRsGyueVLvQ",
    "tags": [
      "aventura",
      "fantasia",
      "drama"
    ]
  },
  {
    "id": "f003",
    "titulo": "Tears of Steel",
    "descricao": "No futuro, um grupo de guerreiros e cientistas se reúne em Amsterdã para tentar reverter os efeitos devastadores de uma guerra contra máquinas.",
    "tempo": "12 min",
    "classificacao": "14",
    "capa": "https://mango.blender.org/wp-content/uploads/2013/05/01_thom_celia_bridge.jpg",
    "youtubeId": "R6MlUcmOul8",
    "tags": [
      "ficção científica",
      "ação"
    ]
  },
  {
    "id": "f004",
    "titulo": "Cosmos Laundromat",
    "descricao": "Um carneiro suicida contrata um vendedor peculiar para lhe dar uma última e inusitada chance na vida, em uma aventura surreal pelo espaço.",
    "tempo": "12 min",
    "classificacao": "16",
    "capa": "https://cloud.blender.org/uploads/gallery/renders/2015/09/franck_hero.jpg",
    "youtubeId": "Y-rmzh0PI3c",
    "tags": [
      "surreal",
      "comédia",
      "drama"
    ]
  },
  {
    "id": "f005",
    "titulo": "Spring",
    "descricao": "Um cervo idoso sente a chegada da primavera e revive, em suas memórias, o ciclo eterno entre vida, sacrifício e renovação da natureza.",
    "tempo": "7 min",
    "classificacao": "Livre",
    "capa": "https://blog.blender.org/wp-content/uploads/2019/04/spring-title.jpg",
    "youtubeId": "WhWc3b3KhnY",
    "tags": [
      "animação",
      "natureza",
      "família"
    ]
  }
];

const SERIES_DATA = [
  {
    "id": "s001",
    "titulo": "Blender Open Movies: Coleção",
    "descricao": "Uma antologia de curtas-metragens experimentais criados pela comunidade Blender, explorando animação, efeitos visuais e narrativas originais em cada episódio.",
    "classificacao": "12",
    "capa": "https://peach.blender.org/wp-content/uploads/title_anouncement.jpg?x11217",
    "tags": [
      "animação",
      "antologia",
      "criatividade"
    ],
    "temporadas": [
      {
        "numero": 1,
        "episodios": [
          {
            "numero": 1,
            "titulo": "O Despertar",
            "descricao": "Um herói acorda em um mundo desconhecido e precisa entender as regras do lugar antes que seja tarde demais.",
            "duracao": "9 min",
            "youtubeId": "aqz-KE-bpKQ"
          },
          {
            "numero": 2,
            "titulo": "A Travessia",
            "descricao": "A jornada continua por terras hostis, testando os limites físicos e emocionais dos personagens.",
            "duracao": "14 min",
            "youtubeId": "eRsGyueVLvQ"
          },
          {
            "numero": 3,
            "titulo": "O Confronto",
            "descricao": "As tensões chegam ao limite em um confronto que muda o rumo de toda a história.",
            "duracao": "11 min",
            "youtubeId": "R6MlUcmOul8"
          }
        ]
      },
      {
        "numero": 2,
        "episodios": [
          {
            "numero": 1,
            "titulo": "Novos Horizontes",
            "descricao": "Uma nova temporada começa com personagens inéditos explorando territórios ainda maiores.",
            "duracao": "12 min",
            "youtubeId": "Y-rmzh0PI3c"
          },
          {
            "numero": 2,
            "titulo": "Renascer",
            "descricao": "Entre memórias e o presente, um personagem reflete sobre ciclos de vida e recomeços.",
            "duracao": "7 min",
            "youtubeId": "WhWc3b3KhnY"
          }
        ]
      }
    ]
  },
  {
    "id": "s002",
    "titulo": "Crônicas do Futuro",
    "descricao": "Em um mundo dominado por tecnologia avançada, um grupo de sobreviventes luta para restaurar a humanidade após uma guerra contra máquinas.",
    "classificacao": "16",
    "capa": "https://mango.blender.org/wp-content/uploads/2013/05/01_thom_celia_bridge.jpg",
    "tags": [
      "ficção científica",
      "ação",
      "drama"
    ],
    "temporadas": [
      {
        "numero": 1,
        "episodios": [
          {
            "numero": 1,
            "titulo": "Amsterdã em Ruínas",
            "descricao": "Cientistas e guerreiros se unem para planejar a última resistência contra a invasão das máquinas.",
            "duracao": "12 min",
            "youtubeId": "R6MlUcmOul8"
          },
          {
            "numero": 2,
            "titulo": "O Plano",
            "descricao": "Um plano arriscado é traçado para reverter os efeitos devastadores da guerra, mas o tempo é curto.",
            "duracao": "10 min",
            "youtubeId": "aqz-KE-bpKQ"
          }
        ]
      }
    ]
  }
];
