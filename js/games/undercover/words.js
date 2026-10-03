// Wortpaare für Undercover: zwei ähnliche Begriffe. Die meisten bekommen das erste Wort, eine Person das zweite.
// Im Spion-Modus bekommt der Spion gar kein Wort; dort werden beide Wörter eines Paares als Begriff genutzt.
export const PAIRS = [
    ['Katze', 'Hund'], ['Kaffee', 'Tee'], ['Cola', 'Limonade'], ['Pizza', 'Flammkuchen'], ['Fußball', 'Handball'],
    ['Banane', 'Gurke'], ['Auto', 'Motorrad'], ['Zug', 'Straßenbahn'], ['Flugzeug', 'Hubschrauber'], ['Sonne', 'Mond'],
    ['Messer', 'Schere'], ['Löffel', 'Gabel'], ['Tasse', 'Becher'], ['Brille', 'Kontaktlinsen'], ['Rucksack', 'Handtasche'],
    ['Jacke', 'Mantel'], ['Hose', 'Rock'], ['Schal', 'Mütze'], ['Socke', 'Strumpf'], ['Schuh', 'Stiefel'],
    ['Apfel', 'Birne'], ['Erdbeere', 'Himbeere'], ['Kartoffel', 'Süßkartoffel'], ['Tomate', 'Paprika'], ['Zwiebel', 'Knoblauch'],
    ['Brot', 'Brötchen'], ['Butter', 'Margarine'], ['Honig', 'Marmelade'], ['Schokolade', 'Praline'], ['Eis', 'Pudding'],
    ['Bier', 'Wein'], ['Wasser', 'Mineralwasser'], ['Saft', 'Smoothie'], ['Suppe', 'Eintopf'], ['Nudeln', 'Reis'],
    ['Hamburger', 'Döner'], ['Pommes', 'Kroketten'], ['Wurst', 'Schinken'], ['Ei', 'Omelett'], ['Käse', 'Quark'],
    ['Haus', 'Wohnung'], ['Hotel', 'Pension'], ['Zelt', 'Wohnwagen'], ['Burg', 'Schloss'], ['Kirche', 'Moschee'],
    ['Strand', 'See'], ['Berg', 'Hügel'], ['Wald', 'Park'], ['Fluss', 'Bach'], ['Insel', 'Halbinsel'],
    ['Regen', 'Schnee'], ['Gewitter', 'Sturm'], ['Nebel', 'Wolke'], ['Sommer', 'Frühling'], ['Winter', 'Herbst'],
    ['Lehrer', 'Professor'], ['Arzt', 'Krankenpfleger'], ['Polizist', 'Soldat'], ['Koch', 'Bäcker'], ['Pilot', 'Kapitän'],
    ['Sänger', 'Schauspieler'], ['Maler', 'Zeichner'], ['Autor', 'Journalist'], ['König', 'Kaiser'], ['Prinzessin', 'Königin'],
    ['Geige', 'Cello'], ['Gitarre', 'Klavier'], ['Trommel', 'Pauke'], ['Flöte', 'Trompete'], ['Radio', 'Fernseher'],
    ['Handy', 'Tablet'], ['Laptop', 'Computer'], ['Maus', 'Tastatur'], ['Kopfhörer', 'Lautsprecher'], ['Kamera', 'Fernglas'],
    ['Bett', 'Sofa'], ['Tisch', 'Schreibtisch'], ['Stuhl', 'Hocker'], ['Lampe', 'Kerze'], ['Spiegel', 'Fenster'],
    ['Buch', 'Zeitschrift'], ['Brief', 'Postkarte'], ['Stift', 'Kugelschreiber'], ['Heft', 'Block'], ['Marker', 'Textmarker'],
    ['Hammer', 'Axt'], ['Schraube', 'Nagel'], ['Säge', 'Feile'], ['Leiter', 'Treppe'], ['Eimer', 'Wanne'],
    ['Schwimmen', 'Tauchen'], ['Tennis', 'Badminton'], ['Skifahren', 'Snowboarden'], ['Laufen', 'Wandern'], ['Boxen', 'Ringen'],
    ['Schach', 'Dame'], ['Poker', 'Skat'], ['Würfel', 'Karten'], ['Puzzle', 'Rätsel'], ['Lego', 'Bauklötze'],
    ['Kino', 'Theater'], ['Zirkus', 'Freizeitpark'], ['Museum', 'Galerie'], ['Zoo', 'Aquarium'], ['Bibliothek', 'Buchhandlung'],
    ['Löwe', 'Tiger'], ['Wolf', 'Fuchs'], ['Adler', 'Falke'], ['Delfin', 'Hai'], ['Pferd', 'Esel'],
    ['Schmetterling', 'Biene'], ['Spinne', 'Ameise'], ['Frosch', 'Kröte'], ['Schlange', 'Eidechse'], ['Hase', 'Kaninchen'],
    ['Rose', 'Tulpe'], ['Sonnenblume', 'Gänseblümchen'], ['Baum', 'Busch'], ['Gras', 'Moos'], ['Kaktus', 'Palme'],
    ['Hochzeit', 'Geburtstag'], ['Weihnachten', 'Ostern'], ['Karneval', 'Halloween'], ['Urlaub', 'Reise'], ['Party', 'Disco'],
    ['Schwimmbad', 'Sauna'], ['Friseur', 'Kosmetikstudio'], ['Bank', 'Sparkasse'], ['Supermarkt', 'Kiosk'], ['Bahnhof', 'Flughafen'],
    ['Parfum', 'Deo'], ['Seife', 'Shampoo'], ['Zahnbürste', 'Zahnseide'], ['Handtuch', 'Bademantel'], ['Dusche', 'Badewanne'],
    ['Regenschirm', 'Regenmantel'], ['Sonnenbrille', 'Sonnencreme'], ['Fahrrad', 'Roller'], ['Taxi', 'Bus'], ['Schiff', 'Boot'],
    ['Gold', 'Silber'], ['Diamant', 'Perle'], ['Ring', 'Armband'], ['Uhr', 'Wecker'], ['Krone', 'Hut'],
    ['Feuer', 'Rauch'], ['Frost', 'Schnee'], ['Wind', 'Wellen'], ['Erdbeben', 'Vulkan'], ['Blitz', 'Donner'],
    ['Pirat', 'Ritter'], ['Zauberer', 'Hexe'], ['Drache', 'Dinosaurier'], ['Vampir', 'Zombie'], ['Roboter', 'Alien'],
    ['Batman', 'Superman'], ['Harry Potter', 'Herr der Ringe'], ['Netflix', 'YouTube'], ['Instagram', 'TikTok'], ['WhatsApp', 'Telegram'],
];

// Begriffe für den Spion-Modus: alle Wörter der Paare
export const SPY_WORDS = [...new Set(PAIRS.flat())];
