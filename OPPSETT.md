# Installasjonsdagen – steg for steg

Det du trenger: **Macen din**, **iPhonen hans**, og de to Ecowitt-nøklene (du har dem fra før).
Regn med 15–20 minutter inkludert kaffe.

## Før du drar (5 min, hjemme)

1. **Last ned scriptet på Macen.** Åpne
   `https://github.com/dnusual/Temp-widget` → fila `TempWidget.js` → knappen **Download raw file**
   (pil ned, øverst til høyre i filvisningen). Bruk grenen `claude/temp-widget-ecowitt-6qhhue`
   hvis den ikke er slått sammen til `main` ennå.
2. **Gi fila nytt navn til `Temp.js`** i Finder. Navnet på fila blir navnet på scriptet i
   Scriptable, og «Temp» er det veiledningen bruker overalt.
3. **Legg nøklene et sted du kan kopiere fra på hans telefon.** Enkleste er å sende dem som
   en tekstmelding til ham fra din egen telefon, én nøkkel per melding, så han kan
   kopiere dem rett fra Meldinger:
   - Application Key (32 tegn, store bokstaver og tall)
   - API Key (36 tegn med bindestreker)

   Nøklene gir bare lesetilgang til målingene, så det er greit å sende dem på SMS.

## Hos ham

### 1. Installer Scriptable (2 min)

På hans iPhone: **App Store** → søk **Scriptable** → appen av *Simon B. Støvring* (lilla
ikon) → **Hent**. Gratis, ingen kjøp i appen.

Åpne Scriptable én gang så den får laget mappa si i iCloud Drive. Du kan lukke den igjen.

### 2. AirDrop scriptet fra Macen (2 min)

1. På iPhonen: sveip ned fra øverst til høyre → hold inne nettverksruta → trykk **AirDrop** →
   **Alle i 10 minutter**. (Ellers finner ikke Macen din telefonen, siden dere har hver deres
   Apple-ID.)
2. På Macen: høyreklikk `Temp.js` → **Del** → **AirDrop** → velg hans iPhone.
3. På iPhonen dukker det opp et valg om hva fila skal åpnes i. Velg **Scriptable** hvis den
   står der. Da legger den seg rett inn som scriptet **Temp**, og du kan hoppe til steg 3.

   Hvis Scriptable ikke står i lista: velg **Arkiver i Filer** → **iCloud Drive** →
   mappa **Scriptable** → **Arkiver**. Åpne Scriptable; scriptet **Temp** ligger nå der.

**Plan B hvis AirDrop er vrangt:** Åpne råfila på GitHub i Safari på *hans* telefon
(`https://raw.githubusercontent.com/dnusual/Temp-widget/claude/temp-widget-ecowitt-6qhhue/TempWidget.js`),
hold inne i teksten → **Marker alt** → **Kopier**. I Scriptable: **+** øverst til høyre →
lim inn → trykk på tittelen øverst → skriv **Temp** → **Ferdig**.

### 3. Kjør scriptet én gang og legg inn nøklene (3 min)

1. I Scriptable: trykk på **Temp**.
2. Første boks spør om **Application Key** og **API Key**. Gå til Meldinger, hold inne
   på nøkkelen → **Kopier**, tilbake til Scriptable, lim inn. Gjør det samme for den andre.
   Trykk **Lagre**.
3. Scriptet henter stasjonene fra kontoen hans. Du får én boks per stasjon:
   - **Skodje** → la navnet stå → **Vis**
   - **Bjorli** → la navnet stå → **Vis**
4. **«Hvilken er hjemme?»** → trykk **Skodje**. Da får Skodje hus-ikon og Bjorli hytte-ikon.
5. Du lander i en meny. Trykk **Vis middels widget** for å se at tallene kommer. Står det
   «Ingen nettforbindelse» eller «Ugyldig API Key», se feilsøking nederst.

### 4. La ham velge utseende (3 min)

I samme meny: **Velg utseende**. Bla gjennom **Lys**, **Stor skrift**, **Farge** og **Tabell**.
Han får se hvert av dem med ekte tall; trykk **Se liten størrelse** for å sammenligne, og
**Bruk denne** når han har bestemt seg. (Dette kan endres når som helst senere, uten å
gjøre noe med widgeten på hjemskjermen.)

Trykk **Ferdig** for å gå ut av menyen.

### 5. Legg widgeten på hjemskjermen (3 min)

1. Gå til hjemskjermen. Hold fingeren på et tomt sted til ikonene begynner å riste.
2. Trykk **Rediger** øverst til venstre → **Legg til widget** (på eldre iOS: **+** øverst
   til venstre).
3. Søk **Scriptable**. Sveip til **middels** størrelse (den brede) → **Legg til widget**.
   Middels er den som viser mest uten å bli trang; liten går også fint.
4. Widgeten er tom og står med tekst «Scriptable». Trykk på den mens ikonene fortsatt
   rister (eller hold inne → **Rediger widget**):
   - **Script** → velg **Temp**
   - **When Interacting** → la stå på *Open App* (da kommer den store oversikten når han
     trykker på widgeten)
   - **Parameter** → la stå tomt
5. Trykk utenfor. Etter noen sekunder vises temperaturene. Trykk **Ferdig** øverst til høyre.

Dra den gjerne til første side, øverst, så han slipper å lete.

### 6. Valgfritt: låseskjermen (2 min)

Hold inne på låseskjermen (telefonen låst opp med Face ID, men ikke sveipet opp) →
**Tilpass** → **Låseskjerm** → trykk på feltet **under klokka** → velg **Scriptable** → den
brede (rektangulære). Trykk på den → **Script: Temp**. Den viser begge stasjonene, alltid i
svart/hvitt. **Ferdig** → **Ferdig**.

### 7. Vis ham før du går

- Trykk på widgeten → den store oversikten åpnes.
- Oransje tall betyr at stasjonen ikke har sendt noe på over 1,5 time (strømbrudd på
  Bjorli?). Den viser da siste kjente verdi.
- iOS oppdaterer widgeter sånn cirka hvert kvarter til hver halvtime. Trykker han på den,
  får han ferske tall med en gang.
- Vil han bytte utseende: Scriptable → **Temp** → **Velg utseende**.

## Hvis noe ikke virker

| Det du ser | Gjør dette |
| --- | --- |
| Macen finner ikke iPhonen i AirDrop | Sjekk at AirDrop på iPhonen står på **Alle i 10 minutter**, og at Wi-Fi og Bluetooth er på begge steder. Ellers: Plan B i steg 2. |
| Scriptet heter ikke «Temp» | Hold inne scriptet i Scriptable → **Rename**. Widgeten må peke på riktig navn. |
| «Ugyldig Application Key» / «Ugyldig API Key» | En av nøklene ble limt inn feil (mellomrom, manglende tegn). Scriptable → **Temp** → **Endre Ecowitt-nøkler**. |
| «Ingen stasjoner funnet» | Nøklene er laget på en annen Ecowitt-konto enn den stasjonene ligger på. Logg inn på ecowitt.net med kontoen fra Ecowitt-appen hans og lag nøklene der. |
| «Ingen nettforbindelse» | Telefonen hans har ikke nett akkurat nå, eller ecowitt.net er nede. Prøv igjen om litt. |
| Widgeten viser «Ikke satt opp» | Scriptet er lagt inn, men ikke kjørt i appen. Gjør steg 3. |
| Widgeten er tom / viser bare «Scriptable» | Widgeten har ikke fått valgt script. Hold inne på widgeten → **Rediger widget** → **Script: Temp**. |
| Tallene står stille i flere timer | Hold inne widgeten → **Rediger widget** → trykk utenfor igjen; det tvinger en oppdatering. Åpne også Scriptable én gang; iOS prioriterer widgeter fra apper som brukes. |

## Etterpå

Om du senere vil endre noe (farger, hvor lenge data regnes som ferske, et nytt utseende):
rediger `TempWidget.js`, og AirDrop fila på nytt som `Temp.js`. Når iPhonen spør, velg
**Erstatt**. Nøkler, stasjoner og valgt utseende ligger i nøkkelringen på telefonen og
overlever oppdateringer av scriptet.
