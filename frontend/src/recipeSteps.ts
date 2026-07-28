import type { SuggestLang } from './mealSuggestions';

/**
 * Cooking method for the curated meal library.
 *
 * Kept in the app rather than fetched, for three reasons: it works with no
 * signal in a kitchen, it costs nothing per view, and it ships over the air
 * like any other copy. Steps are written for a parent cooking on a weeknight —
 * short, no chef vocabulary, no equipment nobody owns.
 *
 * Quantities are deliberately absent. Families cook for two to six people and
 * a fixed "400g pasta" is wrong for most of them; the steps describe the
 * method and let the cook judge the amount.
 */
export interface RecipeMethod {
  /** Rough hands-on time, minutes. Used to set expectations before starting. */
  minutes: number;
  steps: Record<SuggestLang, string[]>;
}

export const RECIPE_METHODS: Record<string, RecipeMethod> = {
  bolognese: {
    minutes: 30,
    steps: {
      en: [
        'Boil the pasta in salted water until just tender.',
        'Meanwhile, soften the chopped onion and garlic in a little oil.',
        'Add the beef and brown it, breaking up any lumps.',
        'Pour in the tomato sauce and simmer for 15 minutes.',
        'Drain the pasta and stir it through the sauce.',
      ],
      es: [
        'Cuece la pasta en agua con sal hasta que esté al dente.',
        'Mientras tanto, pocha la cebolla y el ajo picados en un poco de aceite.',
        'Añade la carne y dórala, deshaciendo los grumos.',
        'Vierte el tomate y deja cocer a fuego lento 15 minutos.',
        'Escurre la pasta y mézclala con la salsa.',
      ],
      fr: [
        'Faites cuire les pâtes dans l’eau salée jusqu’à ce qu’elles soient al dente.',
        'Pendant ce temps, faites revenir l’oignon et l’ail hachés dans un peu d’huile.',
        'Ajoutez la viande et faites-la dorer en écrasant les morceaux.',
        'Versez la sauce tomate et laissez mijoter 15 minutes.',
        'Égouttez les pâtes et mélangez-les à la sauce.',
      ],
      de: [
        'Die Nudeln in Salzwasser bissfest kochen.',
        'Währenddessen Zwiebel und Knoblauch fein hacken und in etwas Öl andünsten.',
        'Das Hackfleisch dazugeben und krümelig anbraten.',
        'Die Tomatensauce angießen und 15 Minuten köcheln lassen.',
        'Die Nudeln abgießen und unter die Sauce heben.',
      ],
    },
  },
  chicken_rice: {
    minutes: 25,
    steps: {
      en: [
        'Start the rice cooking.',
        'Season the chicken and grill or pan-fry until cooked through.',
        'Steam or boil the broccoli for 4 minutes so it stays green.',
        'Warm the crushed garlic in a little oil and spoon it over everything.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Salpimenta el pollo y hazlo a la plancha hasta que esté bien cocido.',
        'Cuece el brócoli 4 minutos para que quede verde.',
        'Calienta el ajo picado en un poco de aceite y riégalo por encima.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Assaisonnez le poulet et faites-le griller jusqu’à cuisson complète.',
        'Faites cuire le brocoli 4 minutes pour qu’il reste vert.',
        'Faites chauffer l’ail écrasé dans un peu d’huile et versez sur le tout.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Das Hähnchen würzen und durchgaren.',
        'Den Brokkoli 4 Minuten garen, damit er grün bleibt.',
        'Den Knoblauch in etwas Öl erwärmen und darüber verteilen.',
      ],
    },
  },
  tacos: {
    minutes: 20,
    steps: {
      en: [
        'Brown the beef with the chopped onion.',
        'Season well and let any liquid cook away.',
        'Warm the tortillas in a dry pan.',
        'Set out the cheese, tomato and lettuce and let everyone build their own.',
      ],
      es: [
        'Dora la carne con la cebolla picada.',
        'Sazona bien y deja que se evapore el líquido.',
        'Calienta las tortillas en una sartén seca.',
        'Saca el queso, el tomate y la lechuga y que cada uno se lo monte.',
      ],
      fr: [
        'Faites dorer la viande avec l’oignon haché.',
        'Assaisonnez et laissez le jus s’évaporer.',
        'Réchauffez les tortillas dans une poêle sèche.',
        'Disposez fromage, tomate et salade et laissez chacun composer le sien.',
      ],
      de: [
        'Das Hackfleisch mit der gehackten Zwiebel anbraten.',
        'Kräftig würzen und die Flüssigkeit einkochen lassen.',
        'Die Tortillas in einer trockenen Pfanne erwärmen.',
        'Käse, Tomate und Salat bereitstellen — jeder belegt selbst.',
      ],
    },
  },
  stir_fry: {
    minutes: 20,
    steps: {
      en: [
        'Start the rice cooking.',
        'Slice the pepper and carrot thinly and break the broccoli into small pieces.',
        'Fry everything hard in a hot pan for 5 to 6 minutes, keeping it moving.',
        'Add the soy sauce at the end and toss once.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Corta el pimiento y la zanahoria finos y separa el brócoli en ramitos.',
        'Saltea todo a fuego fuerte 5 o 6 minutos, sin dejar de mover.',
        'Añade la salsa de soja al final y da un último salteado.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Émincez le poivron et la carotte, détaillez le brocoli en petits bouquets.',
        'Faites sauter le tout à feu vif 5 à 6 minutes sans cesser de remuer.',
        'Ajoutez la sauce soja en fin de cuisson et mélangez une dernière fois.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Paprika und Karotte fein schneiden, den Brokkoli in kleine Röschen teilen.',
        'Alles bei starker Hitze 5 bis 6 Minuten unter Rühren braten.',
        'Zum Schluss die Sojasauce zugeben und einmal durchschwenken.',
      ],
    },
  },
  pizza: {
    minutes: 20,
    steps: {
      en: [
        'Heat the oven as hot as it goes.',
        'Spread the tomato sauce over the base, leaving a rim.',
        'Tear the mozzarella over the top.',
        'Bake 8 to 12 minutes until the edges colour, then scatter the basil.',
      ],
      es: [
        'Calienta el horno al máximo.',
        'Extiende el tomate sobre la base dejando un borde.',
        'Reparte la mozzarella desmenuzada por encima.',
        'Hornea de 8 a 12 minutos hasta que doren los bordes y añade la albahaca.',
      ],
      fr: [
        'Préchauffez le four au maximum.',
        'Étalez la sauce tomate sur la pâte en laissant un bord.',
        'Répartissez la mozzarella déchirée dessus.',
        'Enfournez 8 à 12 minutes jusqu’à ce que les bords colorent, puis ajoutez le basilic.',
      ],
      de: [
        'Den Ofen auf höchste Stufe vorheizen.',
        'Die Tomatensauce auf dem Boden verteilen, einen Rand frei lassen.',
        'Den Mozzarella darüber zupfen.',
        '8 bis 12 Minuten backen, bis der Rand Farbe nimmt, dann Basilikum darüberstreuen.',
      ],
    },
  },
  chicken_curry: {
    minutes: 30,
    steps: {
      en: [
        'Start the rice cooking.',
        'Soften the sliced onion, then stir in the curry paste or powder for a minute.',
        'Add the diced chicken and colour it all over.',
        'Pour in the coconut milk and simmer 15 minutes until the chicken is done.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Pocha la cebolla y añade el curry, removiendo un minuto.',
        'Incorpora el pollo en dados y dóralo por todos lados.',
        'Vierte la leche de coco y cuece 15 minutos hasta que el pollo esté hecho.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Faites fondre l’oignon émincé, puis ajoutez le curry et remuez une minute.',
        'Ajoutez le poulet en dés et faites-le colorer sur toutes les faces.',
        'Versez le lait de coco et laissez mijoter 15 minutes.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Die Zwiebel glasig dünsten, dann das Curry eine Minute mitrösten.',
        'Das gewürfelte Hähnchen zugeben und rundum anbraten.',
        'Die Kokosmilch angießen und 15 Minuten köcheln lassen.',
      ],
    },
  },
  salmon_potato: {
    minutes: 35,
    steps: {
      en: [
        'Halve the potatoes and roast at 200°C for 25 minutes.',
        'Put the salmon on the same tray for the last 12 minutes.',
        'Melt the butter with a squeeze of lemon.',
        'Spoon the lemon butter over the fish before serving.',
      ],
      es: [
        'Parte las patatas por la mitad y ásalas a 200°C durante 25 minutos.',
        'Añade el salmón a la misma bandeja los últimos 12 minutos.',
        'Derrite la mantequilla con un chorrito de limón.',
        'Riega el pescado con la mantequilla al limón antes de servir.',
      ],
      fr: [
        'Coupez les pommes de terre en deux et enfournez à 200°C pendant 25 minutes.',
        'Ajoutez le saumon sur la même plaque pour les 12 dernières minutes.',
        'Faites fondre le beurre avec un filet de citron.',
        'Nappez le poisson de beurre citronné au moment de servir.',
      ],
      de: [
        'Die Kartoffeln halbieren und bei 200°C 25 Minuten rösten.',
        'Den Lachs für die letzten 12 Minuten mit auf das Blech legen.',
        'Die Butter mit einem Spritzer Zitrone schmelzen.',
        'Die Zitronenbutter vor dem Servieren über den Fisch geben.',
      ],
    },
  },
  omelette: {
    minutes: 15,
    steps: {
      en: [
        'Slice the mushrooms and onion and soften them in a pan.',
        'Beat the eggs with a pinch of salt and pour them in.',
        'Pull the setting edges towards the middle as it cooks.',
        'Scatter the cheese over one half, fold, and slide onto the plate.',
      ],
      es: [
        'Corta los champiñones y la cebolla y póchalos en la sartén.',
        'Bate los huevos con una pizca de sal y viértelos.',
        'Ve llevando los bordes cuajados hacia el centro.',
        'Reparte el queso sobre una mitad, dobla y sirve.',
      ],
      fr: [
        'Émincez les champignons et l’oignon et faites-les revenir.',
        'Battez les œufs avec une pincée de sel et versez-les dans la poêle.',
        'Ramenez les bords pris vers le centre pendant la cuisson.',
        'Parsemez le fromage sur une moitié, pliez et servez.',
      ],
      de: [
        'Pilze und Zwiebel in Scheiben schneiden und andünsten.',
        'Die Eier mit einer Prise Salz verquirlen und angießen.',
        'Die stockenden Ränder zur Mitte ziehen.',
        'Den Käse auf einer Hälfte verteilen, zusammenklappen und servieren.',
      ],
    },
  },
  beef_stew: {
    minutes: 120,
    steps: {
      en: [
        'Brown the diced beef in batches so it colours rather than steams.',
        'Add the chopped onion and carrot and cook until softened.',
        'Cover with water or stock and simmer gently for 90 minutes.',
        'Add the potatoes for the last 30 minutes.',
      ],
      es: [
        'Dora la carne en tandas para que se selle y no se cueza.',
        'Añade la cebolla y la zanahoria picadas y rehoga.',
        'Cubre con agua o caldo y cuece a fuego lento 90 minutos.',
        'Incorpora las patatas los últimos 30 minutos.',
      ],
      fr: [
        'Faites dorer la viande en plusieurs fois pour qu’elle colore sans bouillir.',
        'Ajoutez l’oignon et la carotte émincés et faites revenir.',
        'Couvrez d’eau ou de bouillon et laissez mijoter 90 minutes.',
        'Ajoutez les pommes de terre pour les 30 dernières minutes.',
      ],
      de: [
        'Das gewürfelte Rindfleisch portionsweise scharf anbraten.',
        'Zwiebel und Karotte grob schneiden und mitdünsten.',
        'Mit Wasser oder Brühe bedecken und 90 Minuten sanft schmoren.',
        'Die Kartoffeln in den letzten 30 Minuten zugeben.',
      ],
    },
  },
  shrimp_pasta: {
    minutes: 20,
    steps: {
      en: [
        'Boil the pasta in salted water.',
        'Soften the sliced garlic in oil without letting it brown.',
        'Add the prawns and cook 2 to 3 minutes until they turn pink.',
        'Stir in the cream, then toss with the drained pasta.',
      ],
      es: [
        'Cuece la pasta en agua con sal.',
        'Sofríe el ajo laminado en aceite sin que llegue a dorarse.',
        'Añade las gambas y cocínalas 2 o 3 minutos hasta que estén rosadas.',
        'Incorpora la nata y mezcla con la pasta escurrida.',
      ],
      fr: [
        'Faites cuire les pâtes dans l’eau salée.',
        'Faites revenir l’ail émincé dans l’huile sans le laisser brunir.',
        'Ajoutez les crevettes et comptez 2 à 3 minutes jusqu’à ce qu’elles rosissent.',
        'Versez la crème puis mélangez aux pâtes égouttées.',
      ],
      de: [
        'Die Nudeln in Salzwasser kochen.',
        'Den Knoblauch in Öl andünsten, ohne ihn braun werden zu lassen.',
        'Die Garnelen zugeben und 2 bis 3 Minuten garen, bis sie rosa sind.',
        'Die Sahne einrühren und mit den abgegossenen Nudeln vermengen.',
      ],
    },
  },
  caesar: {
    minutes: 20,
    steps: {
      en: [
        'Season the chicken and pan-fry until cooked, then let it rest.',
        'Cube the bread and toast it in the same pan until crisp.',
        'Tear the lettuce into a bowl.',
        'Slice the chicken over the top and finish with the croutons and cheese.',
      ],
      es: [
        'Salpimenta el pollo, hazlo a la plancha y déjalo reposar.',
        'Corta el pan en dados y tuéstalo en la misma sartén.',
        'Trocea la lechuga en un bol.',
        'Lamina el pollo por encima y termina con los picatostes y el queso.',
      ],
      fr: [
        'Assaisonnez le poulet, faites-le cuire à la poêle et laissez-le reposer.',
        'Coupez le pain en dés et faites-le dorer dans la même poêle.',
        'Déchirez la salade dans un saladier.',
        'Émincez le poulet dessus et terminez par les croûtons et le fromage.',
      ],
      de: [
        'Das Hähnchen würzen, in der Pfanne garen und ruhen lassen.',
        'Das Brot würfeln und in derselben Pfanne knusprig rösten.',
        'Den Salat in eine Schüssel zupfen.',
        'Das Hähnchen darüber aufschneiden, Croûtons und Käse darüberstreuen.',
      ],
    },
  },
  tuna_sandwich: {
    minutes: 10,
    steps: {
      en: [
        'Drain the tuna and mix it with a little mayonnaise or olive oil.',
        'Toast the bread if you like it crisp.',
        'Layer the tuna, sliced tomato and lettuce.',
        'Close, press down gently and cut in half.',
      ],
      es: [
        'Escurre el atún y mézclalo con un poco de mayonesa o aceite de oliva.',
        'Tuesta el pan si lo prefieres crujiente.',
        'Monta el atún, el tomate en rodajas y la lechuga.',
        'Cierra, presiona con suavidad y corta por la mitad.',
      ],
      fr: [
        'Égouttez le thon et mélangez-le à un peu de mayonnaise ou d’huile d’olive.',
        'Faites griller le pain si vous l’aimez croustillant.',
        'Superposez le thon, la tomate en rondelles et la salade.',
        'Refermez, pressez légèrement et coupez en deux.',
      ],
      de: [
        'Den Thunfisch abtropfen lassen und mit etwas Mayonnaise oder Olivenöl mischen.',
        'Das Brot nach Wunsch toasten.',
        'Thunfisch, Tomatenscheiben und Salat schichten.',
        'Zusammenklappen, leicht andrücken und halbieren.',
      ],
    },
  },
  lentil_soup: {
    minutes: 40,
    steps: {
      en: [
        'Soften the chopped onion, carrot and garlic in a large pan.',
        'Rinse the lentils and add them.',
        'Cover with plenty of water or stock and bring to a simmer.',
        'Cook 25 to 30 minutes until the lentils are soft, then season well.',
      ],
      es: [
        'Pocha la cebolla, la zanahoria y el ajo picados en una olla.',
        'Enjuaga las lentejas y añádelas.',
        'Cubre con agua o caldo abundante y lleva a ebullición suave.',
        'Cuece de 25 a 30 minutos hasta que estén tiernas y sazona bien.',
      ],
      fr: [
        'Faites revenir l’oignon, la carotte et l’ail hachés dans une grande casserole.',
        'Rincez les lentilles et ajoutez-les.',
        'Couvrez largement d’eau ou de bouillon et portez à frémissement.',
        'Comptez 25 à 30 minutes jusqu’à ce qu’elles soient tendres, puis assaisonnez.',
      ],
      de: [
        'Zwiebel, Karotte und Knoblauch hacken und im Topf andünsten.',
        'Die Linsen abspülen und zugeben.',
        'Reichlich mit Wasser oder Brühe bedecken und aufkochen.',
        '25 bis 30 Minuten garen, bis die Linsen weich sind, dann kräftig würzen.',
      ],
    },
  },
  fried_rice: {
    minutes: 20,
    steps: {
      en: [
        'Use cold cooked rice if you have it — fresh rice turns sticky.',
        'Scramble the eggs in a hot pan and set them aside.',
        'Fry the diced carrot and peas for 3 minutes, then add the rice.',
        'Return the eggs, splash in the soy sauce and toss everything together.',
      ],
      es: [
        'Usa arroz cocido del día anterior — el recién hecho queda pastoso.',
        'Cuaja los huevos revueltos en la sartén caliente y resérvalos.',
        'Saltea la zanahoria en dados y los guisantes 3 minutos y añade el arroz.',
        'Devuelve el huevo, añade la salsa de soja y mezcla todo.',
      ],
      fr: [
        'Utilisez du riz cuit de la veille — le riz frais devient collant.',
        'Faites des œufs brouillés dans la poêle chaude et réservez-les.',
        'Faites sauter la carotte en dés et les petits pois 3 minutes, puis ajoutez le riz.',
        'Remettez les œufs, versez la sauce soja et mélangez le tout.',
      ],
      de: [
        'Am besten kalten Reis vom Vortag verwenden — frischer Reis wird klebrig.',
        'Die Eier in der heißen Pfanne stocken lassen und beiseitestellen.',
        'Karottenwürfel und Erbsen 3 Minuten braten, dann den Reis zugeben.',
        'Die Eier zurückgeben, Sojasauce angießen und alles vermengen.',
      ],
    },
  },
  pork_veg: {
    minutes: 40,
    steps: {
      en: [
        'Halve the potatoes and put them in a hot oven at 200°C.',
        'After 20 minutes add the carrot and broccoli to the tray.',
        'Season the chops and pan-fry 4 to 5 minutes a side.',
        'Rest the meat 5 minutes before serving with the vegetables.',
      ],
      es: [
        'Parte las patatas y mételas al horno caliente a 200°C.',
        'A los 20 minutos añade la zanahoria y el brócoli a la bandeja.',
        'Salpimenta las chuletas y hazlas 4 o 5 minutos por cada lado.',
        'Deja reposar la carne 5 minutos y sirve con la verdura.',
      ],
      fr: [
        'Coupez les pommes de terre en deux et enfournez à 200°C.',
        'Au bout de 20 minutes, ajoutez la carotte et le brocoli sur la plaque.',
        'Assaisonnez les côtes et saisissez-les 4 à 5 minutes par face.',
        'Laissez reposer la viande 5 minutes avant de servir avec les légumes.',
      ],
      de: [
        'Die Kartoffeln halbieren und bei 200°C in den heißen Ofen geben.',
        'Nach 20 Minuten Karotte und Brokkoli mit auf das Blech legen.',
        'Die Koteletts würzen und je Seite 4 bis 5 Minuten braten.',
        'Das Fleisch 5 Minuten ruhen lassen und mit dem Gemüse servieren.',
      ],
    },
  },
  chili: {
    minutes: 45,
    steps: {
      en: [
        'Brown the beef with the chopped onion.',
        'Add the tomatoes and a good spoon of chilli or paprika.',
        'Tip in the drained beans and the corn.',
        'Simmer 25 minutes, stirring now and then, until thick.',
      ],
      es: [
        'Dora la carne con la cebolla picada.',
        'Añade el tomate y una buena cucharada de chile o pimentón.',
        'Incorpora los frijoles escurridos y el maíz.',
        'Cuece 25 minutos removiendo de vez en cuando hasta que espese.',
      ],
      fr: [
        'Faites dorer la viande avec l’oignon haché.',
        'Ajoutez les tomates et une bonne cuillère de piment ou de paprika.',
        'Versez les haricots égouttés et le maïs.',
        'Laissez mijoter 25 minutes en remuant de temps en temps.',
      ],
      de: [
        'Das Hackfleisch mit der gehackten Zwiebel anbraten.',
        'Die Tomaten und einen kräftigen Löffel Chili oder Paprika zugeben.',
        'Die abgetropften Bohnen und den Mais unterrühren.',
        '25 Minuten unter gelegentlichem Rühren einkochen lassen.',
      ],
    },
  },
  caprese_pasta: {
    minutes: 15,
    steps: {
      en: [
        'Boil the pasta in salted water.',
        'Chop the tomatoes and tear the mozzarella while it cooks.',
        'Drain the pasta and let it cool for a minute so the cheese does not melt away.',
        'Toss everything with olive oil and the basil leaves.',
      ],
      es: [
        'Cuece la pasta en agua con sal.',
        'Trocea los tomates y desmenuza la mozzarella mientras cuece.',
        'Escurre y deja templar un minuto para que el queso no se derrita del todo.',
        'Mezcla todo con aceite de oliva y las hojas de albahaca.',
      ],
      fr: [
        'Faites cuire les pâtes dans l’eau salée.',
        'Coupez les tomates et déchirez la mozzarella pendant la cuisson.',
        'Égouttez et laissez tiédir une minute pour que le fromage ne fonde pas complètement.',
        'Mélangez le tout avec l’huile d’olive et les feuilles de basilic.',
      ],
      de: [
        'Die Nudeln in Salzwasser kochen.',
        'Währenddessen die Tomaten schneiden und den Mozzarella zupfen.',
        'Abgießen und eine Minute abkühlen lassen, damit der Käse nicht zerläuft.',
        'Alles mit Olivenöl und den Basilikumblättern vermengen.',
      ],
    },
  },
  fish_rice: {
    minutes: 25,
    steps: {
      en: [
        'Start the rice cooking.',
        'Season the fish and pan-fry skin-side down for most of the time.',
        'Wilt the spinach in the same pan for the last minute.',
        'Squeeze the lemon over the fish just before serving.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Salpimenta el pescado y hazlo con la piel hacia abajo casi todo el tiempo.',
        'Saltea las espinacas en la misma sartén el último minuto.',
        'Exprime el limón sobre el pescado justo antes de servir.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Assaisonnez le poisson et saisissez-le côté peau la majeure partie du temps.',
        'Faites tomber les épinards dans la même poêle la dernière minute.',
        'Pressez le citron sur le poisson juste avant de servir.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Den Fisch würzen und überwiegend auf der Hautseite braten.',
        'Den Spinat in der letzten Minute in derselben Pfanne zusammenfallen lassen.',
        'Kurz vor dem Servieren die Zitrone darüber auspressen.',
      ],
    },
  },
  quesadilla: {
    minutes: 10,
    steps: {
      en: [
        'Lay a tortilla in a dry pan over medium heat.',
        'Cover half with cheese and ham, then fold it over.',
        'Press down and cook 2 minutes a side until golden.',
        'Cut into wedges and eat while the cheese is still stringy.',
      ],
      es: [
        'Pon una tortilla en una sartén seca a fuego medio.',
        'Cubre la mitad con queso y jamón y dóblala.',
        'Presiona y cocina 2 minutos por cada lado hasta que dore.',
        'Corta en triángulos y come mientras el queso hace hilos.',
      ],
      fr: [
        'Posez une tortilla dans une poêle sèche à feu moyen.',
        'Garnissez une moitié de fromage et de jambon, puis repliez.',
        'Pressez et comptez 2 minutes par face jusqu’à ce que ce soit doré.',
        'Coupez en parts et mangez tant que le fromage file.',
      ],
      de: [
        'Eine Tortilla in eine trockene Pfanne bei mittlerer Hitze legen.',
        'Eine Hälfte mit Käse und Schinken belegen und zusammenklappen.',
        'Andrücken und je Seite 2 Minuten goldbraun backen.',
        'In Stücke schneiden und essen, solange der Käse Fäden zieht.',
      ],
    },
  },
  veggie_curry: {
    minutes: 25,
    steps: {
      en: [
        'Start the rice cooking.',
        'Warm the curry paste or powder in a little oil for a minute.',
        'Add the drained chickpeas and the coconut milk and simmer 10 minutes.',
        'Stir the spinach through at the end until it wilts.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Calienta el curry en un poco de aceite durante un minuto.',
        'Añade los garbanzos escurridos y la leche de coco y cuece 10 minutos.',
        'Incorpora las espinacas al final hasta que se ablanden.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Faites chauffer le curry dans un peu d’huile pendant une minute.',
        'Ajoutez les pois chiches égouttés et le lait de coco, mijotez 10 minutes.',
        'Incorporez les épinards en fin de cuisson jusqu’à ce qu’ils tombent.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Das Curry eine Minute in etwas Öl anrösten.',
        'Die abgetropften Kichererbsen und die Kokosmilch zugeben, 10 Minuten köcheln.',
        'Zum Schluss den Spinat unterrühren, bis er zusammenfällt.',
      ],
    },
  },
  carbonara: {
    minutes: 20,
    steps: {
      en: [
        'Beat the eggs with the grated cheese in a bowl.',
        'Boil the pasta and keep a cup of the cooking water.',
        'Crisp the bacon in a pan while the pasta cooks.',
        'Off the heat, toss the drained pasta with the egg mix, loosening with the water.',
      ],
      es: [
        'Bate los huevos con el queso rallado en un bol.',
        'Cuece la pasta y reserva una taza del agua de cocción.',
        'Dora el bacon en una sartén mientras tanto.',
        'Fuera del fuego, mezcla la pasta con el huevo, aflojando con el agua reservada.',
      ],
      fr: [
        'Battez les œufs avec le fromage râpé dans un bol.',
        'Faites cuire les pâtes et gardez un verre d’eau de cuisson.',
        'Faites griller les lardons pendant ce temps.',
        'Hors du feu, mélangez les pâtes égouttées aux œufs en détendant avec l’eau.',
      ],
      de: [
        'Die Eier mit dem geriebenen Käse verquirlen.',
        'Die Nudeln kochen und eine Tasse Kochwasser aufheben.',
        'Währenddessen den Speck knusprig braten.',
        'Vom Herd genommen die Nudeln mit der Eimasse mischen, mit Kochwasser lösen.',
      ],
    },
  },
  noodle_soup: {
    minutes: 35,
    steps: {
      en: [
        'Simmer the chicken with the onion and carrot in plenty of water for 20 minutes.',
        'Lift out the chicken and shred it.',
        'Add the noodles to the broth and cook until tender.',
        'Return the chicken, season well and serve hot.',
      ],
      es: [
        'Cuece el pollo con la cebolla y la zanahoria en agua abundante 20 minutos.',
        'Saca el pollo y desmenúzalo.',
        'Añade los fideos al caldo y cuécelos hasta que estén tiernos.',
        'Devuelve el pollo, sazona bien y sirve caliente.',
      ],
      fr: [
        'Faites frémir le poulet avec l’oignon et la carotte dans beaucoup d’eau 20 minutes.',
        'Retirez le poulet et effilochez-le.',
        'Ajoutez les nouilles au bouillon et laissez cuire.',
        'Remettez le poulet, assaisonnez et servez bien chaud.',
      ],
      de: [
        'Das Hähnchen mit Zwiebel und Karotte 20 Minuten in reichlich Wasser ziehen lassen.',
        'Das Fleisch herausnehmen und zerpflücken.',
        'Die Nudeln in die Brühe geben und weich kochen.',
        'Das Hähnchen zurückgeben, kräftig würzen und heiß servieren.',
      ],
    },
  },
  stuffed_peppers: {
    minutes: 50,
    steps: {
      en: [
        'Cook the rice until just done.',
        'Brown the beef and stir in the chopped tomato and the rice.',
        'Halve the peppers, remove the seeds and fill them.',
        'Bake at 190°C for 30 minutes until the peppers soften.',
      ],
      es: [
        'Cuece el arroz hasta que esté en su punto.',
        'Dora la carne y mezcla el tomate picado y el arroz.',
        'Parte los pimientos, retira las semillas y rellénalos.',
        'Hornea a 190°C durante 30 minutos hasta que estén tiernos.',
      ],
      fr: [
        'Faites cuire le riz.',
        'Faites dorer la viande et mélangez-y la tomate concassée et le riz.',
        'Coupez les poivrons en deux, épépinez-les et garnissez-les.',
        'Enfournez à 190°C pendant 30 minutes jusqu’à ce qu’ils soient tendres.',
      ],
      de: [
        'Den Reis bissfest garen.',
        'Das Hackfleisch anbraten, gehackte Tomate und Reis untermischen.',
        'Die Paprika halbieren, entkernen und füllen.',
        'Bei 190°C 30 Minuten backen, bis die Paprika weich ist.',
      ],
    },
  },
  avocado_eggs: {
    minutes: 10,
    steps: {
      en: [
        'Toast the bread.',
        'Mash the avocado with salt and a squeeze of lemon if you have one.',
        'Fry or poach the eggs to your liking.',
        'Spread the avocado on the toast and slide the eggs on top.',
      ],
      es: [
        'Tuesta el pan.',
        'Machaca el aguacate con sal y un chorrito de limón si tienes.',
        'Haz los huevos fritos o escalfados como más te gusten.',
        'Extiende el aguacate sobre la tostada y coloca los huevos encima.',
      ],
      fr: [
        'Faites griller le pain.',
        'Écrasez l’avocat avec du sel et un filet de citron si vous en avez.',
        'Faites les œufs au plat ou pochés selon votre goût.',
        'Étalez l’avocat sur le pain et déposez les œufs dessus.',
      ],
      de: [
        'Das Brot toasten.',
        'Die Avocado mit Salz und etwas Zitrone zerdrücken.',
        'Die Eier nach Wunsch braten oder pochieren.',
        'Die Avocado auf den Toast streichen und die Eier daraufgeben.',
      ],
    },
  },
  chicken_fajitas: {
    minutes: 25,
    steps: {
      en: [
        'Slice the chicken, pepper and onion into strips.',
        'Fry the chicken hard until coloured, then add the vegetables.',
        'Season with paprika, cumin or a fajita mix and cook 5 more minutes.',
        'Warm the tortillas and let everyone fill their own.',
      ],
      es: [
        'Corta el pollo, el pimiento y la cebolla en tiras.',
        'Saltea el pollo a fuego fuerte y añade luego las verduras.',
        'Sazona con pimentón, comino o mezcla para fajitas y cocina 5 minutos más.',
        'Calienta las tortillas y que cada uno se sirva.',
      ],
      fr: [
        'Détaillez le poulet, le poivron et l’oignon en lanières.',
        'Saisissez le poulet à feu vif puis ajoutez les légumes.',
        'Assaisonnez de paprika, cumin ou mélange fajitas et poursuivez 5 minutes.',
        'Réchauffez les tortillas et laissez chacun se servir.',
      ],
      de: [
        'Hähnchen, Paprika und Zwiebel in Streifen schneiden.',
        'Das Hähnchen scharf anbraten, dann das Gemüse zugeben.',
        'Mit Paprika, Kreuzkümmel oder Fajita-Gewürz würzen und 5 Minuten weitergaren.',
        'Die Tortillas erwärmen und jeden selbst füllen lassen.',
      ],
    },
  },
  mac_cheese: {
    minutes: 25,
    steps: {
      en: [
        'Boil the pasta in salted water.',
        'Melt the butter, stir in a spoon of flour, then whisk in the milk slowly.',
        'Once it thickens, take it off the heat and stir in the cheese.',
        'Fold through the drained pasta and season.',
      ],
      es: [
        'Cuece la pasta en agua con sal.',
        'Derrite la mantequilla, añade una cucharada de harina y vierte la leche poco a poco.',
        'Cuando espese, retira del fuego e incorpora el queso.',
        'Mezcla con la pasta escurrida y sazona.',
      ],
      fr: [
        'Faites cuire les pâtes dans l’eau salée.',
        'Faites fondre le beurre, ajoutez une cuillère de farine puis le lait petit à petit.',
        'Dès que la sauce épaissit, hors du feu, incorporez le fromage.',
        'Mélangez aux pâtes égouttées et assaisonnez.',
      ],
      de: [
        'Die Nudeln in Salzwasser kochen.',
        'Die Butter schmelzen, einen Löffel Mehl einrühren, dann nach und nach die Milch.',
        'Sobald die Sauce bindet, vom Herd nehmen und den Käse einrühren.',
        'Die abgegossenen Nudeln unterheben und abschmecken.',
      ],
    },
  },
  blt: {
    minutes: 10,
    steps: {
      en: [
        'Fry the bacon until crisp and drain it on kitchen paper.',
        'Toast the bread.',
        'Layer the bacon, sliced tomato and lettuce, with mayonnaise if you like.',
        'Close, cut on the diagonal and serve straight away.',
      ],
      es: [
        'Fríe el bacon hasta que esté crujiente y escúrrelo en papel de cocina.',
        'Tuesta el pan.',
        'Monta el bacon, el tomate en rodajas y la lechuga, con mayonesa si quieres.',
        'Cierra, corta en diagonal y sirve enseguida.',
      ],
      fr: [
        'Faites griller le bacon jusqu’à ce qu’il soit croustillant et égouttez-le.',
        'Faites griller le pain.',
        'Superposez le bacon, la tomate en rondelles et la salade, avec un peu de mayonnaise.',
        'Refermez, coupez en diagonale et servez aussitôt.',
      ],
      de: [
        'Den Speck knusprig braten und auf Küchenpapier abtropfen lassen.',
        'Das Brot toasten.',
        'Speck, Tomatenscheiben und Salat schichten, nach Wunsch mit Mayonnaise.',
        'Zusammenklappen, diagonal halbieren und sofort servieren.',
      ],
    },
  },
  frittata: {
    minutes: 30,
    steps: {
      en: [
        'Dice the potato small and fry it until tender, then add the chopped pepper.',
        'Beat the eggs with the cheese and plenty of seasoning.',
        'Pour the eggs over the vegetables and cook gently until the edges set.',
        'Finish under a hot grill for 3 minutes until puffed and golden.',
      ],
      es: [
        'Corta la patata en dados pequeños y fríela hasta que esté tierna; añade el pimiento.',
        'Bate los huevos con el queso y sazona bien.',
        'Vierte el huevo sobre la verdura y cuaja a fuego suave por los bordes.',
        'Termina bajo el grill 3 minutos hasta que suba y dore.',
      ],
      fr: [
        'Coupez la pomme de terre en petits dés, faites-la revenir puis ajoutez le poivron.',
        'Battez les œufs avec le fromage et assaisonnez généreusement.',
        'Versez les œufs sur les légumes et laissez prendre doucement sur les bords.',
        'Terminez sous le gril 3 minutes jusqu’à ce que ce soit gonflé et doré.',
      ],
      de: [
        'Die Kartoffel klein würfeln, weich braten, dann die gehackte Paprika zugeben.',
        'Die Eier mit dem Käse verquirlen und kräftig würzen.',
        'Die Eimasse über das Gemüse gießen und bei milder Hitze stocken lassen.',
        'Unter dem heißen Grill 3 Minuten goldbraun fertig backen.',
      ],
    },
  },
  teriyaki_salmon: {
    minutes: 25,
    steps: {
      en: [
        'Start the rice cooking.',
        'Mix the soy sauce with a spoon of honey or sugar to make the glaze.',
        'Pan-fry the salmon 3 to 4 minutes a side, then spoon the glaze over.',
        'Steam the broccoli for 4 minutes and serve alongside.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Mezcla la salsa de soja con una cucharada de miel o azúcar para el glaseado.',
        'Haz el salmón 3 o 4 minutos por lado y riégalo con el glaseado.',
        'Cuece el brócoli 4 minutos y sírvelo al lado.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Mélangez la sauce soja avec une cuillère de miel ou de sucre pour le glaçage.',
        'Saisissez le saumon 3 à 4 minutes par face, puis nappez-le de glaçage.',
        'Faites cuire le brocoli 4 minutes et servez à côté.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Die Sojasauce mit einem Löffel Honig oder Zucker zur Glasur verrühren.',
        'Den Lachs je Seite 3 bis 4 Minuten braten, dann die Glasur darübergeben.',
        'Den Brokkoli 4 Minuten dämpfen und dazu servieren.',
      ],
    },
  },
  minestrone: {
    minutes: 40,
    steps: {
      en: [
        'Soften the chopped onion, carrot and any other vegetables in a large pan.',
        'Add the tomatoes and cover with water or stock.',
        'Simmer 20 minutes, then add the drained beans and the pasta.',
        'Cook until the pasta is tender and season generously.',
      ],
      es: [
        'Pocha la cebolla, la zanahoria y las verduras que tengas en una olla.',
        'Añade el tomate y cubre con agua o caldo.',
        'Cuece 20 minutos y añade los frijoles escurridos y la pasta.',
        'Cocina hasta que la pasta esté tierna y sazona generosamente.',
      ],
      fr: [
        'Faites revenir l’oignon, la carotte et les légumes disponibles dans une grande casserole.',
        'Ajoutez les tomates et couvrez d’eau ou de bouillon.',
        'Laissez mijoter 20 minutes, puis ajoutez les haricots égouttés et les pâtes.',
        'Poursuivez jusqu’à ce que les pâtes soient tendres et assaisonnez généreusement.',
      ],
      de: [
        'Zwiebel, Karotte und weiteres Gemüse im großen Topf andünsten.',
        'Die Tomaten zugeben und mit Wasser oder Brühe bedecken.',
        '20 Minuten köcheln, dann die abgetropften Bohnen und die Nudeln zugeben.',
        'Garen, bis die Nudeln weich sind, und großzügig abschmecken.',
      ],
    },
  },
  pesto_pasta: {
    minutes: 15,
    steps: {
      en: [
        'Boil the pasta and keep a little cooking water.',
        'Blitz or pound the basil with the garlic, cheese and olive oil.',
        'Toss the drained pasta with the pesto off the heat.',
        'Loosen with the reserved water until it coats every strand.',
      ],
      es: [
        'Cuece la pasta y reserva un poco del agua.',
        'Tritura la albahaca con el ajo, el queso y el aceite de oliva.',
        'Mezcla la pasta escurrida con el pesto fuera del fuego.',
        'Afloja con el agua reservada hasta que envuelva bien la pasta.',
      ],
      fr: [
        'Faites cuire les pâtes et gardez un peu d’eau de cuisson.',
        'Mixez le basilic avec l’ail, le fromage et l’huile d’olive.',
        'Mélangez les pâtes égouttées au pesto hors du feu.',
        'Détendez avec l’eau réservée jusqu’à bien enrober les pâtes.',
      ],
      de: [
        'Die Nudeln kochen und etwas Kochwasser aufheben.',
        'Basilikum mit Knoblauch, Käse und Olivenöl pürieren.',
        'Die abgegossenen Nudeln vom Herd genommen mit dem Pesto mischen.',
        'Mit dem Kochwasser lösen, bis alles gleichmäßig überzogen ist.',
      ],
    },
  },
  chicken_quesadilla: {
    minutes: 20,
    steps: {
      en: [
        'Cook the sliced chicken with the chopped pepper until done.',
        'Lay a tortilla in a dry pan and scatter over cheese and the filling.',
        'Fold, press down and cook 2 minutes a side.',
        'Cut into wedges and serve hot.',
      ],
      es: [
        'Cocina el pollo en tiras con el pimiento picado.',
        'Pon una tortilla en una sartén seca y reparte el queso y el relleno.',
        'Dobla, presiona y cocina 2 minutos por cada lado.',
        'Corta en triángulos y sirve caliente.',
      ],
      fr: [
        'Faites cuire le poulet émincé avec le poivron haché.',
        'Posez une tortilla dans une poêle sèche, parsemez de fromage et de garniture.',
        'Repliez, pressez et comptez 2 minutes par face.',
        'Coupez en parts et servez chaud.',
      ],
      de: [
        'Das geschnittene Hähnchen mit der gehackten Paprika garen.',
        'Eine Tortilla in die trockene Pfanne legen, Käse und Füllung darauf verteilen.',
        'Zusammenklappen, andrücken und je Seite 2 Minuten backen.',
        'In Stücke schneiden und heiß servieren.',
      ],
    },
  },
  shepherds_pie: {
    minutes: 60,
    steps: {
      en: [
        'Boil the potatoes, then mash them with butter and a splash of milk.',
        'Brown the beef with the chopped onion and carrot.',
        'Add the peas and a little stock and simmer 10 minutes.',
        'Spread the mash over the meat and bake at 200°C for 25 minutes.',
      ],
      es: [
        'Cuece las patatas y hazlas puré con mantequilla y un chorro de leche.',
        'Dora la carne con la cebolla y la zanahoria picadas.',
        'Añade los guisantes y un poco de caldo y cuece 10 minutos.',
        'Cubre la carne con el puré y hornea a 200°C durante 25 minutos.',
      ],
      fr: [
        'Faites cuire les pommes de terre puis écrasez-les avec du beurre et un peu de lait.',
        'Faites dorer la viande avec l’oignon et la carotte hachés.',
        'Ajoutez les petits pois et un peu de bouillon, mijotez 10 minutes.',
        'Étalez la purée sur la viande et enfournez à 200°C pendant 25 minutes.',
      ],
      de: [
        'Die Kartoffeln kochen und mit Butter und einem Schuss Milch stampfen.',
        'Das Hackfleisch mit gehackter Zwiebel und Karotte anbraten.',
        'Die Erbsen und etwas Brühe zugeben und 10 Minuten köcheln.',
        'Das Püree auf dem Fleisch verteilen und bei 200°C 25 Minuten backen.',
      ],
    },
  },
  fish_tacos: {
    minutes: 20,
    steps: {
      en: [
        'Season the fish and pan-fry 3 minutes a side, then flake it.',
        'Shred the lettuce finely.',
        'Warm the tortillas in a dry pan.',
        'Fill with fish and lettuce and squeeze the lemon over.',
      ],
      es: [
        'Salpimenta el pescado, hazlo 3 minutos por lado y desmenúzalo.',
        'Corta la lechuga en juliana fina.',
        'Calienta las tortillas en una sartén seca.',
        'Rellena con el pescado y la lechuga y exprime el limón por encima.',
      ],
      fr: [
        'Assaisonnez le poisson, saisissez-le 3 minutes par face puis émiettez-le.',
        'Émincez finement la salade.',
        'Réchauffez les tortillas dans une poêle sèche.',
        'Garnissez de poisson et de salade et pressez le citron dessus.',
      ],
      de: [
        'Den Fisch würzen, je Seite 3 Minuten braten und zerpflücken.',
        'Den Salat fein schneiden.',
        'Die Tortillas in einer trockenen Pfanne erwärmen.',
        'Mit Fisch und Salat füllen und die Zitrone darüber auspressen.',
      ],
    },
  },
  noodle_stirfry: {
    minutes: 20,
    steps: {
      en: [
        'Cook the noodles, drain and rinse them under cold water.',
        'Scramble the eggs in a hot pan and set aside.',
        'Fry the sliced carrot for 3 minutes, then add the noodles and soy sauce.',
        'Return the eggs and stir the spinach through until it wilts.',
      ],
      es: [
        'Cuece los fideos, escúrrelos y pásalos por agua fría.',
        'Cuaja los huevos revueltos en la sartén caliente y resérvalos.',
        'Saltea la zanahoria 3 minutos y añade los fideos y la soja.',
        'Devuelve el huevo e incorpora las espinacas hasta que se ablanden.',
      ],
      fr: [
        'Faites cuire les nouilles, égouttez-les et rincez-les à l’eau froide.',
        'Faites des œufs brouillés dans la poêle chaude et réservez.',
        'Faites sauter la carotte 3 minutes puis ajoutez les nouilles et la sauce soja.',
        'Remettez les œufs et incorporez les épinards jusqu’à ce qu’ils tombent.',
      ],
      de: [
        'Die Nudeln kochen, abgießen und kalt abspülen.',
        'Die Eier in der heißen Pfanne stocken lassen und beiseitestellen.',
        'Die Karotte 3 Minuten braten, dann Nudeln und Sojasauce zugeben.',
        'Die Eier zurückgeben und den Spinat unterheben, bis er zusammenfällt.',
      ],
    },
  },
  greek_salad: {
    minutes: 10,
    steps: {
      en: [
        'Cut the cucumber and tomato into rough chunks.',
        'Slice the onion as thinly as you can.',
        'Crumble or cube the cheese over the top.',
        'Dress with olive oil, a little vinegar, salt and oregano.',
      ],
      es: [
        'Corta el pepino y el tomate en trozos grandes.',
        'Corta la cebolla en juliana muy fina.',
        'Desmenuza o trocea el queso por encima.',
        'Aliña con aceite de oliva, un poco de vinagre, sal y orégano.',
      ],
      fr: [
        'Coupez le concombre et la tomate en gros morceaux.',
        'Émincez l’oignon le plus finement possible.',
        'Émiettez ou coupez le fromage dessus.',
        'Assaisonnez d’huile d’olive, d’un peu de vinaigre, de sel et d’origan.',
      ],
      de: [
        'Gurke und Tomate in grobe Stücke schneiden.',
        'Die Zwiebel so fein wie möglich hobeln.',
        'Den Käse darüber zerbröseln oder würfeln.',
        'Mit Olivenöl, etwas Essig, Salz und Oregano anmachen.',
      ],
    },
  },
  sausage_peppers: {
    minutes: 30,
    steps: {
      en: [
        'Brown the sausages in a pan and set them aside.',
        'Slice the pepper and onion and cook them in the same pan until soft and sweet.',
        'Return the sausages and finish cooking together for 10 minutes.',
        'Pile into split bread or serve with it on the side.',
      ],
      es: [
        'Dora las salchichas en la sartén y resérvalas.',
        'Corta el pimiento y la cebolla y póchalos en la misma sartén.',
        'Devuelve las salchichas y cocina todo junto 10 minutos.',
        'Sirve dentro del pan abierto o con el pan al lado.',
      ],
      fr: [
        'Faites dorer les saucisses dans une poêle et réservez-les.',
        'Émincez le poivron et l’oignon et faites-les fondre dans la même poêle.',
        'Remettez les saucisses et poursuivez la cuisson 10 minutes.',
        'Servez dans du pain ouvert ou avec le pain à côté.',
      ],
      de: [
        'Die Würste in der Pfanne anbraten und beiseitestellen.',
        'Paprika und Zwiebel in Streifen schneiden und in derselben Pfanne weich dünsten.',
        'Die Würste zurückgeben und 10 Minuten gemeinsam fertig garen.',
        'In aufgeschnittenes Brot füllen oder das Brot dazu reichen.',
      ],
    },
  },
  zucchini_pasta: {
    minutes: 20,
    steps: {
      en: [
        'Boil the pasta in salted water.',
        'Slice the courgette into thin rounds and fry until golden at the edges.',
        'Add the sliced garlic and chopped tomato and cook 5 minutes.',
        'Toss with the drained pasta and a spoon of the cooking water.',
      ],
      es: [
        'Cuece la pasta en agua con sal.',
        'Corta el calabacín en rodajas finas y dóralo por los bordes.',
        'Añade el ajo laminado y el tomate picado y cocina 5 minutos.',
        'Mezcla con la pasta escurrida y una cucharada del agua de cocción.',
      ],
      fr: [
        'Faites cuire les pâtes dans l’eau salée.',
        'Coupez la courgette en fines rondelles et faites-les dorer.',
        'Ajoutez l’ail émincé et la tomate concassée, poursuivez 5 minutes.',
        'Mélangez aux pâtes égouttées avec une cuillère d’eau de cuisson.',
      ],
      de: [
        'Die Nudeln in Salzwasser kochen.',
        'Die Zucchini in dünne Scheiben schneiden und goldbraun anbraten.',
        'Knoblauchscheiben und gehackte Tomate zugeben und 5 Minuten garen.',
        'Mit den abgegossenen Nudeln und einem Löffel Kochwasser vermengen.',
      ],
    },
  },
  jollof_rice: {
    minutes: 45,
    steps: {
      en: [
        'Blend the tomatoes, onion and pepper into a smooth paste.',
        'Fry the paste in oil for 10 minutes until it darkens and loses its raw smell.',
        'Season the chicken, brown it, and set it aside.',
        'Stir the washed rice into the sauce, add just enough stock to cover, and cover tightly.',
        'Cook on a low heat 20 to 25 minutes without stirring, then fold in the chicken.',
      ],
      es: [
        'Tritura los tomates, la cebolla y el pimiento hasta obtener una pasta fina.',
        'Fríe la pasta en aceite 10 minutos hasta que oscurezca y pierda el olor crudo.',
        'Sazona el pollo, dóralo y resérvalo.',
        'Incorpora el arroz lavado a la salsa, cubre justo con caldo y tapa bien.',
        'Cuece a fuego bajo de 20 a 25 minutos sin remover y añade el pollo.',
      ],
      fr: [
        'Mixez les tomates, l’oignon et le poivron en une purée lisse.',
        'Faites revenir cette purée à l’huile 10 minutes, jusqu’à ce qu’elle fonce et perde son goût cru.',
        'Assaisonnez le poulet, faites-le dorer et réservez.',
        'Versez le riz lavé dans la sauce, mouillez juste à hauteur et couvrez hermétiquement.',
        'Laissez cuire à feu doux 20 à 25 minutes sans remuer, puis ajoutez le poulet.',
      ],
      de: [
        'Tomaten, Zwiebel und Paprika zu einer glatten Paste pürieren.',
        'Die Paste 10 Minuten in Öl anbraten, bis sie dunkler wird und nicht mehr roh riecht.',
        'Das Hähnchen würzen, anbraten und beiseitestellen.',
        'Den gewaschenen Reis unter die Sauce rühren, knapp mit Brühe bedecken und fest abdecken.',
        'Bei schwacher Hitze 20 bis 25 Minuten ohne Rühren garen, dann das Hähnchen unterheben.',
      ],
    },
  },
  chicken_yassa: {
    minutes: 60,
    steps: {
      en: [
        'Marinate the chicken in lemon juice, sliced onion and a little chilli — an hour if you can.',
        'Lift out the chicken and brown it well on both sides.',
        'Cook the onions slowly in the same pan until soft and golden.',
        'Return the chicken with the marinade and simmer 25 minutes until cooked through.',
        'Serve over rice with plenty of the onion sauce.',
      ],
      es: [
        'Marina el pollo con zumo de limón, cebolla en juliana y algo de chile, una hora si puedes.',
        'Saca el pollo y dóralo bien por ambos lados.',
        'Pocha las cebollas despacio en la misma sartén hasta que estén doradas.',
        'Devuelve el pollo con la marinada y cuece 25 minutos hasta que esté hecho.',
        'Sirve sobre arroz con abundante salsa de cebolla.',
      ],
      fr: [
        'Faites mariner le poulet dans le jus de citron, l’oignon émincé et un peu de piment, une heure si possible.',
        'Retirez le poulet et faites-le bien dorer des deux côtés.',
        'Faites fondre les oignons doucement dans la même poêle jusqu’à ce qu’ils blondissent.',
        'Remettez le poulet avec la marinade et laissez mijoter 25 minutes.',
        'Servez sur du riz avec beaucoup de sauce à l’oignon.',
      ],
      de: [
        'Das Hähnchen in Zitronensaft, Zwiebelringen und etwas Chili marinieren, nach Möglichkeit eine Stunde.',
        'Das Hähnchen herausnehmen und beidseitig kräftig anbraten.',
        'Die Zwiebeln in derselben Pfanne langsam goldgelb schmoren.',
        'Das Hähnchen mit der Marinade zurückgeben und 25 Minuten garen.',
        'Auf Reis servieren, mit reichlich Zwiebelsauce.',
      ],
    },
  },
  groundnut_stew: {
    minutes: 75,
    steps: {
      en: [
        'Brown the diced beef in batches and set it aside.',
        'Soften the chopped onion, then add the tomatoes and cook down.',
        'Loosen the peanut butter with a ladle of hot water and stir it in until smooth.',
        'Return the beef, cover with water and simmer 45 minutes until tender.',
        'Serve with rice, and season only at the end — the sauce reduces a lot.',
      ],
      es: [
        'Dora la carne en dados por tandas y resérvala.',
        'Pocha la cebolla picada y añade los tomates hasta que reduzcan.',
        'Afloja la pasta de cacahuete con un cazo de agua caliente e incorpórala hasta que quede lisa.',
        'Devuelve la carne, cubre con agua y cuece 45 minutos hasta que esté tierna.',
        'Sirve con arroz y sazona al final: la salsa reduce mucho.',
      ],
      fr: [
        'Faites dorer la viande en dés en plusieurs fois et réservez.',
        'Faites revenir l’oignon haché, ajoutez les tomates et laissez réduire.',
        'Détendez la pâte d’arachide avec une louche d’eau chaude et incorporez-la jusqu’à ce que ce soit lisse.',
        'Remettez la viande, couvrez d’eau et laissez mijoter 45 minutes.',
        'Servez avec du riz et salez seulement à la fin : la sauce réduit beaucoup.',
      ],
      de: [
        'Das gewürfelte Rindfleisch portionsweise anbraten und beiseitestellen.',
        'Die gehackte Zwiebel andünsten, die Tomaten zugeben und einkochen lassen.',
        'Die Erdnusspaste mit einer Kelle heißem Wasser glattrühren und unterziehen.',
        'Das Fleisch zurückgeben, mit Wasser bedecken und 45 Minuten schmoren.',
        'Mit Reis servieren und erst zum Schluss abschmecken — die Sauce reduziert stark.',
      ],
    },
  },
  okra_soup: {
    minutes: 35,
    steps: {
      en: [
        'Slice or grate the okra — grated gives the thicker, silkier sauce.',
        'Soften the chopped onion in the palm oil.',
        'Add the tomatoes and cook until they break down.',
        'Stir in the okra and cook 10 minutes; do not cover it or it dulls.',
        'Add the fish in pieces and simmer gently 8 minutes until it flakes.',
      ],
      es: [
        'Corta o ralla el quimbombó: rallado da una salsa más espesa y sedosa.',
        'Pocha la cebolla picada en el aceite de palma.',
        'Añade los tomates y cocina hasta que se deshagan.',
        'Incorpora el quimbombó y cocina 10 minutos; no lo tapes o pierde color.',
        'Añade el pescado en trozos y cuece suavemente 8 minutos.',
      ],
      fr: [
        'Émincez ou râpez les gombos : râpés, la sauce est plus épaisse et plus soyeuse.',
        'Faites fondre l’oignon haché dans l’huile de palme.',
        'Ajoutez les tomates et laissez-les se défaire.',
        'Incorporez les gombos et comptez 10 minutes ; ne couvrez pas, ils terniraient.',
        'Ajoutez le poisson en morceaux et laissez frémir 8 minutes.',
      ],
      de: [
        'Die Okra in Scheiben schneiden oder reiben — gerieben wird die Sauce dicker und seidiger.',
        'Die gehackte Zwiebel im Palmöl andünsten.',
        'Die Tomaten zugeben und zerfallen lassen.',
        'Die Okra einrühren und 10 Minuten garen; nicht abdecken, sonst verliert sie die Farbe.',
        'Den Fisch in Stücken zugeben und 8 Minuten sanft ziehen lassen.',
      ],
    },
  },
  yam_tomato: {
    minutes: 40,
    steps: {
      en: [
        'Peel the yam thickly, cut into rounds and rinse.',
        'Boil in salted water 20 to 25 minutes until a knife slides in easily.',
        'Meanwhile fry the chopped onion, then add the tomatoes and cook down to a thick sauce.',
        'Add the fish and simmer 8 minutes until it flakes.',
        'Drain the yam and serve the sauce over it.',
      ],
      es: [
        'Pela el ñame con generosidad, córtalo en rodajas y enjuágalo.',
        'Cuécelo en agua con sal de 20 a 25 minutos hasta que el cuchillo entre con facilidad.',
        'Mientras, sofríe la cebolla picada y añade los tomates hasta obtener una salsa espesa.',
        'Incorpora el pescado y cuece 8 minutos.',
        'Escurre el ñame y sírvelo con la salsa por encima.',
      ],
      fr: [
        'Épluchez généreusement l’igname, coupez-la en rondelles et rincez.',
        'Faites bouillir 20 à 25 minutes dans l’eau salée, jusqu’à ce que la lame entre facilement.',
        'Pendant ce temps, faites revenir l’oignon puis les tomates jusqu’à obtenir une sauce épaisse.',
        'Ajoutez le poisson et laissez frémir 8 minutes.',
        'Égouttez l’igname et nappez-la de sauce.',
      ],
      de: [
        'Die Yamswurzel großzügig schälen, in Scheiben schneiden und abspülen.',
        'In Salzwasser 20 bis 25 Minuten kochen, bis ein Messer leicht hineingleitet.',
        'Währenddessen die Zwiebel anbraten, die Tomaten zugeben und zu einer dicken Sauce einkochen.',
        'Den Fisch zugeben und 8 Minuten ziehen lassen.',
        'Die Yamswurzel abgießen und die Sauce darübergeben.',
      ],
    },
  },
  red_red: {
    minutes: 40,
    steps: {
      en: [
        'Soften the chopped onion in the palm oil until it turns deep red.',
        'Add the tomatoes and cook down for 10 minutes.',
        'Tip in the drained beans and simmer 15 minutes, adding water if it tightens.',
        'Slice the plantain on the diagonal and fry until golden on both sides.',
        'Serve the beans with the fried plantain alongside.',
      ],
      es: [
        'Pocha la cebolla picada en el aceite de palma hasta que tome un rojo intenso.',
        'Añade los tomates y cocina 10 minutos.',
        'Incorpora los frijoles escurridos y cuece 15 minutos, añadiendo agua si espesa demasiado.',
        'Corta el plátano en diagonal y fríelo hasta que dore por ambos lados.',
        'Sirve los frijoles con el plátano frito al lado.',
      ],
      fr: [
        'Faites fondre l’oignon haché dans l’huile de palme jusqu’à ce qu’elle prenne une teinte rouge foncé.',
        'Ajoutez les tomates et laissez cuire 10 minutes.',
        'Versez les haricots égouttés et laissez mijoter 15 minutes, en ajoutant de l’eau si ça épaissit.',
        'Coupez la banane plantain en biais et faites-la dorer des deux côtés.',
        'Servez les haricots avec les plantains frits à côté.',
      ],
      de: [
        'Die gehackte Zwiebel im Palmöl dünsten, bis es tiefrot wird.',
        'Die Tomaten zugeben und 10 Minuten einkochen.',
        'Die abgetropften Bohnen zugeben und 15 Minuten köcheln, bei Bedarf Wasser nachgießen.',
        'Die Kochbanane schräg aufschneiden und beidseitig goldbraun braten.',
        'Die Bohnen mit den gebratenen Kochbananen servieren.',
      ],
    },
  },
  garden_egg_stew: {
    minutes: 40,
    steps: {
      en: [
        'Boil the garden eggs 10 minutes until soft, then drain and mash them.',
        'Fry the chopped onion until golden.',
        'Add the tomatoes and cook down to a thick sauce.',
        'Stir the mashed garden eggs into the sauce and simmer 10 minutes.',
        'Add the fish in pieces and warm through for 5 minutes.',
      ],
      es: [
        'Cuece las berenjenas 10 minutos hasta que estén blandas, escúrrelas y machácalas.',
        'Sofríe la cebolla picada hasta que dore.',
        'Añade los tomates y reduce hasta obtener una salsa espesa.',
        'Incorpora las berenjenas machacadas y cuece 10 minutos.',
        'Añade el pescado en trozos y calienta 5 minutos.',
      ],
      fr: [
        'Faites bouillir les aubergines 10 minutes jusqu’à ce qu’elles soient tendres, égouttez et écrasez-les.',
        'Faites dorer l’oignon haché.',
        'Ajoutez les tomates et laissez réduire en sauce épaisse.',
        'Incorporez les aubergines écrasées et laissez mijoter 10 minutes.',
        'Ajoutez le poisson en morceaux et réchauffez 5 minutes.',
      ],
      de: [
        'Die Auberginen 10 Minuten weich kochen, abgießen und zerdrücken.',
        'Die gehackte Zwiebel goldbraun anbraten.',
        'Die Tomaten zugeben und zu einer dicken Sauce einkochen.',
        'Das Auberginenmus unterrühren und 10 Minuten köcheln lassen.',
        'Den Fisch in Stücken zugeben und 5 Minuten durchwärmen.',
      ],
    },
  },
  grilled_tilapia: {
    minutes: 35,
    steps: {
      en: [
        'Score the fish on both sides and season inside and out.',
        'Grill or bake at 200°C for 12 to 15 minutes a side until the flesh flakes cleanly.',
        'Blend the chilli and onion with a little oil and salt.',
        'Warm the pepper sauce through in a pan for 5 minutes.',
        'Squeeze lemon over the fish and serve the sauce alongside.',
      ],
      es: [
        'Haz cortes en el pescado por ambos lados y sazónalo por dentro y por fuera.',
        'Ásalo a 200°C de 12 a 15 minutos por lado hasta que la carne se separe con facilidad.',
        'Tritura el chile y la cebolla con un poco de aceite y sal.',
        'Calienta la salsa picante en una sartén 5 minutos.',
        'Exprime limón sobre el pescado y sirve la salsa al lado.',
      ],
      fr: [
        'Incisez le poisson des deux côtés et assaisonnez-le dedans comme dehors.',
        'Faites-le braiser ou cuire à 200°C, 12 à 15 minutes par face, jusqu’à ce que la chair se détache.',
        'Mixez le piment et l’oignon avec un peu d’huile et de sel.',
        'Faites chauffer la sauce piment à la poêle 5 minutes.',
        'Pressez du citron sur le poisson et servez la sauce à côté.',
      ],
      de: [
        'Den Fisch beidseitig einschneiden und innen wie außen würzen.',
        'Bei 200°C je Seite 12 bis 15 Minuten garen, bis sich das Fleisch löst.',
        'Chili und Zwiebel mit etwas Öl und Salz pürieren.',
        'Die Chilisauce in der Pfanne 5 Minuten erwärmen.',
        'Zitrone über den Fisch pressen und die Sauce dazu reichen.',
      ],
    },
  },
  attieke_fish: {
    minutes: 30,
    steps: {
      en: [
        'Steam the attiéké for 10 minutes, or sprinkle with water and warm it covered.',
        'Season the fish and grill or fry until cooked through.',
        'Slice the onion thinly and mix with chopped tomato, salt and a little oil.',
        'Fluff the attiéké with a fork so it does not clump.',
        'Serve the fish on the attiéké with the onion and tomato on top.',
      ],
      es: [
        'Cuece el attiéké al vapor 10 minutos, o rocíalo con agua y caliéntalo tapado.',
        'Sazona el pescado y hazlo a la parrilla o a la sartén hasta que esté cocido.',
        'Corta la cebolla muy fina y mézclala con tomate picado, sal y un poco de aceite.',
        'Suelta el attiéké con un tenedor para que no se apelmace.',
        'Sirve el pescado sobre el attiéké con la cebolla y el tomate encima.',
      ],
      fr: [
        'Faites cuire l’attiéké à la vapeur 10 minutes, ou humectez-le et réchauffez-le à couvert.',
        'Assaisonnez le poisson et faites-le griller ou poêler jusqu’à cuisson complète.',
        'Émincez finement l’oignon et mélangez-le à la tomate coupée, du sel et un filet d’huile.',
        'Égrainez l’attiéké à la fourchette pour qu’il ne colle pas.',
        'Servez le poisson sur l’attiéké, avec l’oignon et la tomate dessus.',
      ],
      de: [
        'Den Attiéké 10 Minuten dämpfen oder mit Wasser besprenkeln und abgedeckt erwärmen.',
        'Den Fisch würzen und durchgaren.',
        'Die Zwiebel fein hobeln und mit gehackter Tomate, Salz und etwas Öl mischen.',
        'Den Attiéké mit der Gabel auflockern, damit er nicht klumpt.',
        'Den Fisch auf dem Attiéké anrichten und mit Zwiebel und Tomate belegen.',
      ],
    },
  },
  banku_okra: {
    minutes: 50,
    steps: {
      en: [
        'Mix the corn flour with water to a smooth batter with no lumps.',
        'Cook it over a low heat, stirring hard and constantly, 20 to 25 minutes until thick and glossy.',
        'Shape into balls with a wet hand and keep them covered.',
        'For the soup, cook the chopped onion and tomatoes down, then stir in the sliced okra.',
        'Add the fish and simmer 8 minutes, then serve with the banku.',
      ],
      es: [
        'Mezcla la harina de maíz con agua hasta obtener una masa lisa sin grumos.',
        'Cuécela a fuego bajo removiendo con fuerza sin parar, de 20 a 25 minutos, hasta que espese y brille.',
        'Forma bolas con la mano mojada y mantenlas tapadas.',
        'Para la salsa, reduce la cebolla y los tomates y añade el quimbombó en rodajas.',
        'Incorpora el pescado, cuece 8 minutos y sirve con el banku.',
      ],
      fr: [
        'Délayez la farine de maïs dans l’eau jusqu’à obtenir une pâte lisse et sans grumeaux.',
        'Faites cuire à feu doux en remuant vigoureusement sans arrêt, 20 à 25 minutes, jusqu’à ce que ce soit épais et brillant.',
        'Façonnez des boules à la main mouillée et gardez-les couvertes.',
        'Pour la sauce, faites réduire l’oignon et les tomates puis ajoutez les gombos émincés.',
        'Ajoutez le poisson, laissez frémir 8 minutes et servez avec le banku.',
      ],
      de: [
        'Das Maismehl mit Wasser zu einem glatten, klümpchenfreien Teig verrühren.',
        'Bei schwacher Hitze 20 bis 25 Minuten unter kräftigem Rühren garen, bis die Masse dick und glänzend ist.',
        'Mit nasser Hand Kugeln formen und abgedeckt warm halten.',
        'Für die Sauce Zwiebel und Tomaten einkochen, dann die geschnittene Okra unterrühren.',
        'Den Fisch zugeben, 8 Minuten ziehen lassen und mit dem Banku servieren.',
      ],
    },
  },
  peanut_spinach: {
    minutes: 30,
    steps: {
      en: [
        'Start the rice cooking.',
        'Fry the chopped onion, then add the tomatoes and cook down.',
        'Loosen the peanut butter with hot water and stir it into the sauce.',
        'Add the spinach and let it wilt into the sauce, 5 minutes.',
        'Simmer another 5 minutes and serve over the rice.',
      ],
      es: [
        'Pon el arroz a cocer.',
        'Sofríe la cebolla picada y añade los tomates hasta que reduzcan.',
        'Afloja la pasta de cacahuete con agua caliente e incorpórala a la salsa.',
        'Añade las espinacas y deja que se integren, 5 minutos.',
        'Cuece 5 minutos más y sirve sobre el arroz.',
      ],
      fr: [
        'Mettez le riz à cuire.',
        'Faites revenir l’oignon haché puis ajoutez les tomates et laissez réduire.',
        'Détendez la pâte d’arachide à l’eau chaude et incorporez-la à la sauce.',
        'Ajoutez les épinards et laissez-les tomber dans la sauce, 5 minutes.',
        'Laissez mijoter encore 5 minutes et servez sur le riz.',
      ],
      de: [
        'Den Reis aufsetzen.',
        'Die gehackte Zwiebel anbraten, die Tomaten zugeben und einkochen lassen.',
        'Die Erdnusspaste mit heißem Wasser glattrühren und in die Sauce geben.',
        'Den Spinat zugeben und 5 Minuten zusammenfallen lassen.',
        'Weitere 5 Minuten köcheln und über dem Reis servieren.',
      ],
    },
  },
  sweet_potato_chicken: {
    minutes: 45,
    steps: {
      en: [
        'Heat the oven to 200°C.',
        'Cut the sweet potato into chunks and the pepper and onion into wide strips.',
        'Toss everything with oil, salt and any spice you like, on one tray.',
        'Tuck the seasoned chicken among the vegetables.',
        'Roast 35 to 40 minutes, turning once, until the chicken is cooked through.',
      ],
      es: [
        'Calienta el horno a 200°C.',
        'Corta el boniato en trozos y el pimiento y la cebolla en tiras anchas.',
        'Mézclalo todo con aceite, sal y las especias que quieras, en una bandeja.',
        'Coloca el pollo sazonado entre las verduras.',
        'Asa de 35 a 40 minutos, dando la vuelta una vez, hasta que el pollo esté hecho.',
      ],
      fr: [
        'Préchauffez le four à 200°C.',
        'Coupez les patates douces en gros morceaux, le poivron et l’oignon en larges lanières.',
        'Mélangez le tout avec de l’huile, du sel et les épices de votre choix sur une plaque.',
        'Glissez le poulet assaisonné entre les légumes.',
        'Enfournez 35 à 40 minutes en retournant une fois, jusqu’à cuisson complète du poulet.',
      ],
      de: [
        'Den Ofen auf 200°C vorheizen.',
        'Die Süßkartoffel in Stücke, Paprika und Zwiebel in breite Streifen schneiden.',
        'Alles mit Öl, Salz und beliebigen Gewürzen auf einem Blech vermengen.',
        'Das gewürzte Hähnchen zwischen das Gemüse setzen.',
        '35 bis 40 Minuten rösten, einmal wenden, bis das Hähnchen durchgegart ist.',
      ],
    },
  },
};

/**
 * Method for a saved or suggested meal, in the language being read.
 * Returns null for meals the user typed themselves, and for any recipe id we
 * no longer ship — the caller shows nothing rather than an empty step list.
 */
export function recipeMethod(
  recipeId: string | null | undefined,
  lang: SuggestLang,
): { minutes: number; steps: string[] } | null {
  if (!recipeId) return null;
  const method = RECIPE_METHODS[recipeId];
  if (!method) return null;
  const steps = method.steps[lang] ?? method.steps.en;
  if (!steps || steps.length === 0) return null;
  return { minutes: method.minutes, steps };
}
