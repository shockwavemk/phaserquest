class Game extends Phaser.Scene {

  constructor() {
    super();

    this.borderPadding = 10; // size of the gray border of the game window
    this.HUDheight = 32; // height of the HUD bar at the bottom (with life etc.)
    this.achievementsHolderWidth = 850,
    this.barY = 0, // y position of that very same bar
    this.nbGroundLayers: 4, // number of tilemap layers corresponding to "ground" elements (ground, grass, water, cliffs), vs high elements (trees, houses, ...)
    this.defaultOrientation: 4, // Face down by default
    this.playerSpeed: 120, // number of ms that the movement tween takes to cross one tile (the lower the faster)
    this.playerLife: 100, // Max health of a player
    this.cursor: 'url(https://this.martin-kramer.com/assets/sprites/hand.png), auto', // image of the mouse cursor in normal circumstances
    this.talkCursor: 'url(https://this.martin-kramer.com/assets/sprites/talk.png), auto', // image of the cursor when hovering NPC
    this.lootCursor: 'url(https://this.martin-kramer.com/assets/sprites/loot.png), auto', // image of cursors when hovering loot
    this.fightCursor: 'url(https://this.martin-kramer.com/assets/sprites/sword.png), auto', // image of cursor when hovering monster
    this.markerPosition: new Phaser.Geom.Point(), // current position of the square marker indicating the highlighted tile
    this.previousMarkerPosition: new Phaser.Geom.Point(), // previous position of that marker
    this.cameraFollowing: true, // is the camera centered on the player
    this.mapWideningY: 54, // y coordinate (in tiles) of the region of the map above which the bounds of the world are wider
    this.speechBubbleCornerSize: 5, // size of the sprite used to make the corners of the speech bubbles
    this.healthBarWidth: 179, // width of the sprite representing the life of the player
    this.nbConnected: 0, // number of players connected to the game
    this.playerIsInitialized: false, // has the client received data from the server and created the world?
    this.inDoor: false, // is the player currently in an indoors location
    this.HPdelay: 100, // Delay before displaying hit points
    this.maxChatLength: 300, // Max length of text to input in chat
    this.latency: 0, // Initial latency of the client; continuously updated by values from server
    this.charactersPool: {}, // Map of the players in the game, accessed by their player id
    this.clickDelay: Phaser.Time.Clock.SECOND * 0.2, // minimum time between player mouse clicks
    this.clickEnabled: true // bool used to check if the player has clicked faster than the click delay
  }

  init() {
      this.easystar = new EasyStar.js();
      this.canvas.style.cursor = this.cursor; // Sets the pointer to hand sprite
  }

  preload() {
      this.load.tilemap('map', 'https://this.martin-kramer.com/assets/maps/minimap_client.json', null, Phaser.Tilemap.TILED_JSON);
      this.load.spritesheet('tileset', 'https://this.martin-kramer.com/assets/tilesets/tilesheet.png',32,32);
      this.load.atlasJSONHash('atlas4', 'https://this.martin-kramer.com/assets/sprites/atlas4.png', 'assets/sprites/atlas4.json'); // Atlas of monsters
      this.load.spritesheet('bubble', 'https://this.martin-kramer.com/assets/sprites/bubble2.png',5,5); // tilesprite used to make speech bubbles
      this.load.spritesheet('life', 'https://this.martin-kramer.com/assets/sprites/lifelvl.png',5,18); // tilesprite used to make lifebar
      this.load.audio('sounds','https://this.martin-kramer.com/assets/audio/sounds.mp3','assets/audio/sounds.ogg'); // audio sprite of all sound effects
      this.load.json('entities', 'https://this.martin-kramer.com/assets/json/entities_client.json'); // Basically a list of the NPC, mapping their id to the key used in other JSON files
  }

  // Makes a map mapping the numerical id's of elements of a collection to their names (their names being the keys used to fetch relevant data from JSON files)
  makeIDmap(collection, map){
      Object.keys(collection).forEach(function(key) {
          var e = collection[key];
          map[e.id] = key;
      });
  }

  create() {
      this.HUD = this.add.group(); // Group containing all objects involved in the HUD
      this.HUD.add(this.add.sprite(0, 0, 'atlas1','border')); // Adds the gray border of the game
      this.displayLoadingScreen(); // Display the loading screen

      // A few maps mapping the name of an element (a monster, npc, item...) to its properties
      // Put before other functions, which might need it
      this.itemsInfo = this.db.items;
      this.npcInfo = this.db.npc;
      this.monstersInfo = this.db.monsters;
      this.findLocationAchievements(); // Scan the list of location-based achievements and store them somewhere

      // A few maps mapping numerical id's to string keys
      this.itemsIDmap = {};
      this.monstersIDmap = {};
      this.makeIDmap(this.itemsInfo, this.itemsIDmap);
      this.makeIDmap(this.monstersInfo, this.monstersIDmap);
      this.entities = this.add.group(); // Group containing all the objects appearing on the map (npc, monster, items, players ...)
      this.scenery = this.add.group(); // Group containing all the animated sprites generated from the map

      this.displayMap(); // Reads the Tiled JSON to generate the map, manage layers, create collision array for the pathfinding and make a dictionary of teleports
      //this.displayScenery(); // Finds all "scenery" tiles in the map and replace them by animated sprites
      this.displayNPC(); // Read the Tiled JSON and display the NPC

      this.createMarker(); // Creates the marker following the pointer that highlight tiles
      this.makeHPtexts(); // Creates a pool of text elements to use to display HP
      this.addSounds(); // Add the sounds of the game to some global object

      // Factories used to fecth unused sprites before creating new ones (or creating new ones when no other available)
      this.playerFactory = new Factory(function(x,y,key){
          return new Player(x,y,key);
      });
      this.itemFactory = new Factory(function(x,y,key){
          return new Item(x, y, key);
      });
      this.monsterFactory = new Factory(function(x,y,key){
          return new Monster(x, y, key);
      });

      Client.requestData();
  }

  // Main update function; processes the global update packages received from the server
  updateWorld(data) { // data is the update package from the server
      var createdPlayers = [];
      if(data.newplayers) {
          for (var n = 0; n < data.newplayers.length; n++) {
              this.createPlayer(data.newplayers[n]);
              createdPlayers.push(data.newplayers[n].id);
          }
          if (data.newplayers.length > 0) this.sortEntities(); // Sort entitites according to y coordinate to make them render properly above each other
      }

      // Create new monsters and items and store them in the appropriate maps
      if(data.newitems) this.populateTable(this.itemsTable,data.newitems,this.createItem);
      if(data.newmonsters) {
          this.populateTable(this.monstersTable,data.newmonsters,this.createMonster);
          this.sortEntities();
      }

      for (var n = 0; n < createdPlayers.length; n++) {
          var player = this.charactersPool[createdPlayers[n]];
          if(player.inFight){
              player.target = this.monstersTable[player.targetID]; // ultimately, target is object, not ID
              player.fight();
          }
      }

      if(data.disconnected) { // data.disconnected is an array of disconnected players
          for (var i = 0; i < data.disconnected.length; i++) {
              this.removePlayer(this.charactersPool[data.disconnected[i]],true); // animate death
          }
      }

      // data.items, data.players and data.monsters are associative arrays mapping the id's of the entities
      // to small object indicating which properties need to be updated. The following code iterate over
      // these objects and call the relevant update functions.
      if(data.items) this.traverseUpdateObject(data.items,this.itemsTable,this.updateItem);
      // "Status" updates ; used to update some properties that need to be set before taking any real action on the game objects
      if(data.players) this.traverseUpdateObject(data.players,this.charactersPool,this.updatePlayerStatus);
      if(data.monsters) this.traverseUpdateObject(data.monsters,this.monstersTable,this.updateMonsterStatus);
      // "Action" updates
      if(data.players) this.traverseUpdateObject(data.players,this.charactersPool,this.updatePlayerAction);
      if(data.monsters) this.traverseUpdateObject(data.monsters,this.monstersTable,this.updateMonsterAction);
  }
  // For each element in arr, call the callback on it and store the result in the map 'table'
  populateTable(table,arr,callback) {
      for(var i = 0; i < arr.length; i++) {
          var data = arr[i];
          // The callback receives the object received from the server as an argument, uses the relevant factory to create
          // the proper sprite, and returns that sprite
          var object = callback(data);
          object.id = data.id;
          table[data.id] = object;
      }
  }
  // For each element in obj, call callback on it
  traverseUpdateObject(obj,table,callback) {
      Object.keys(obj).forEach(function (key) {
          if(table[key]) callback(table[key],obj[key]);
      });
  }

  // CREATION CODE
  // These functions are supposed to return a sprite, whether by creating one from scratch, recycling and old one or
  // fetching the appropriate already existing one, based on the info in the 'data' packer from the server
createMonster(data) { // data contains the data from the server on the new entity to create
      var monster = (this.monstersTable[data.id] ?
              this.monstersTable[data.id] :
              this.monsterFactory.next(data.x * this.map.tileWidth, data.y * this.map.tileHeight, 'atlas4')
      );
      monster.setUp(this.monstersIDmap[data.monster]);
      this.updateMonsterStatus(monster,data);
      this.updateMonsterAction(monster,data);
      return monster;
  }

  createItem(data) { // data contains the data from the server on the new entity to create
      var item;
      if(this.itemsTable[data.id]) {
          item = this.itemsTable[data.id]
      }  else{
          item = this.itemFactory.next(data.x * this.map.tileWidth, data.y * this.map.tileHeight, 'atlas3');
          item.setUp(this.itemsIDmap[data.itemID], data.chest, data.inChest, data.visible, data.respawn, data.loot);
      }
      this.updateItem(item,data);
      return item;
  }

  createPlayer(data) { // data contains the data from the server on the new entity to create
      var player;
      if(this.charactersPool[data.id]){
          player = this.charactersPool[data.id];
      }else{
          player = this.newPlayer(data.x,data.y,data.id);
      }
      if(!data.alive) player.visible = false;
      this.setUpPlayer(player,data);
      this.updatePlayerStatus(player,data);
      this.updatePlayerAction(player,data);
      this.displayedPlayers.add(player.id);
  }

  newPlayer(x,y,id) {
      var player = this.playerFactory.next(x*this.map.tileWidth,y*this.map.tileHeight,'atlas3');
      player.orientation = this.defaultOrientation;
      player.id = id;
      this.entities.add(player);
      this.charactersPool[id] = player;
      this.sortEntities();
      return player;
  }

  setUpPlayer(player,data) { // data contains the data from the server on the new entity to create
      player.setName(data.name);
      player.speed = this.playerSpeed;
      player.orientation = this.defaultOrientation;
  }

  fadeInTween(object) { // Fade-in effect used to spawn items and monsters
      object.alpha = 0;
      var tween = this.add.tween(object);
      tween.to({alpha: 1}, Phaser.Timer.SECOND/2);
      tween.start();
  }

  // UPDATE CODE

  updatePlayerStatus(player,info) { // info contains the updated data from the server
      if(info.connected == false){
          this.removePlayer(player,true);
          return;
      }
      if(info.x && info.y) player.position.set(info.x*this.map.tileWidth, info.y*this.map.tileHeight);

      if(info.aoi){ // Update the id of the AOI that the player is in
          player.aoi = info.aoi;
          if(player.isPlayer) this.updateDisplayList();
      }

      if(info.alive == false && player.alive == true) player.flagForDeath();
      if(info.weapon) this.updateEquipment(player,info.weapon);
      if(info.armor) this.updateEquipment(player,info.armor);
      if(info.weapon || info.armor) player.idle(false); // If an equipment change has taken place, need to resume idling animation
      if(info.targetID !== undefined) player.target = (info.targetID ? this.monstersTable[info.targetID] : null);
  }

  updateDisplayList() {
      // Whenever the player moves to a different AOI, for each player displayed in the game, check if it will still be
      // visible from the new AOI; if not, remove it
      if(!this.displayedPlayers) return;
      var adjacent = AOIutils.listAdjacentAOIs(this.player.aoi);
      this.displayedPlayers.forEach(function(pid){
          var p = this.charactersPool[pid];
          // check if the AOI of player p is in the list of the AOI's adjacent to the main player
          if(p) if(adjacent.indexOf(p.aoi) == -1) this.removePlayer(p,false); // false: don't animate death
      });
  }

updateEquipment(player,eqID) {
      var equipment = this.itemsIDmap[eqID];
      var itemInfo = this.itemsInfo[equipment];
      if(itemInfo.type == 1){ // weapon
          player.equipWeapon(equipment);
      }else if(itemInfo.type == 2){ // armor
          player.equipArmor(equipment);
      }
  }

  updatePlayerAction(player,info) { // info contains the updated data from the server
      if(info.alive == true && player.alive == false) player.respawn();
      if(!player.alive) return;
      if(info.alive == false && player.alive == true){
          if(!player.isPlayer){ // only for other players; for self, attackAndDisplay will be used instead
              var hitter = this.monstersTable[info.lastHitter];
              if(hitter) hitter.attack();
              player.delayedDeath(500);
          }
          return;
      }
      if (!player.isPlayer && info.route) this.moveCharacter(player.id,info.route.end,info.route.orientation,info.route.delta);
      if(info.inFight == false && player.inFight == true){
          player.endFight();
      }else if(info.inFight == true && player.inFight == false) {
          player.fight();
      }
  }

  updateMonsterStatus(monster,info) { // info contains the updated data from the server
      if(info.alive == false && monster.alive == true){
          monster.flagForDeath();
          monster.delayedDeath(500);
          return;
      }
      if(info.x && info.y) monster.position.set(info.x*this.map.tileWidth,info.y*this.map.tileHeight);
      if(info.targetID !== undefined) monster.target = this.charactersPool[info.targetID];
  }

  updateMonsterAction(monster,info){ // info contains the updated data from the server
      if(info.alive == false && monster.alive == true){
          var hitter = this.charactersPool[info.lastHitter];
          if(hitter) hitter.attack();
          return;
      }else if(info.alive == true && monster.alive == false){
          monster.respawn();
      }
      if (info.route) this.moveMonster(monster.id,info.route.path, info.route.delta);
      if(info.inFight == false && monster.inFight == true){
          monster.endFight();
      }else if(info.inFight == true && monster.inFight == false) {
          monster.fight();
      }
  }

  updateItem(item,info){ // info contains the updated data from the server
      if(info.visible == false && item.alive == true) {
          item.remove();
      }else if(info.visible == true && item.alive == false){
          item.respawn();
      }
      if(info.inChest == false && item.inChest == true) item.open();
  }

  updateSelf(data){
      // Whereas updateWorld processes the global updates from the server about entities in the world, updateSelf
      // processes updates specific to the player, visible only to him
      if(data.life !== undefined){
          this.player.life = data.life;
          this.player.updateLife();
      }
      if(data.x != undefined && data.y != undefined){
          if(!this.player.alive) this.player.respawn(); // A change of position is send via personal update package only in case of respawn, so respawn is called immediately
          this.player.position.set(data.x*this.map.tileWidth, data.y*this.map.tileHeight);
          this.followPlayer();
      }
      // data.hp is an array of "hp" objects, which contain info about hit points to display over specific targets
      if(data.hp !== undefined) {
          for (var h = 0; h < data.hp.length; h++) {
              var hp = data.hp[h];
              if (hp.target == false) { // The HP should appear above the player
                  if(hp.from !== undefined){
                      var attacker = this.monstersTable[hp.from];
                      attacker.attackAndDisplay(-(hp.hp));
                  }else{
                      this.player.displayHP(hp.hp, 0);
                  }
              } else if (hp.target == true) { // The HP should appear above the target monster
                  this.player.attackAndDisplay(-(hp.hp));
              }
          }
      }
      if(data.killed){ // array of monsters killed by the player since last packet
          for(var i = 0; i < data.killed.length; i++){
              var killed = this.monstersInfo[this.monstersIDmap[data.killed[i]]].name;
              this.messageIn('You killed a '+killed+'!');
              this.handleKillAchievement(data.killed[i]);
          }
      }
      if(data.used){ // array of items used by the player since last packet
          for(var i = 0; i < data.used.length; i++){
              var used = this.itemsInfo[this.itemsIDmap[data.used[i]]];
              if(used.msg) this.messageIn(used.msg);
              if(!this.weaponAchievement || !this.armorAchievement) this.handleLootAchievement(data.used[i]);
          }
      }
      if(data.noPick){ // boolean indicating whether the player tried to pick an inferior item
          this.messageIn('You already have better equipment!');
          this.sounds.play('noloot');
      }
  }

  revivePlayer(){ // Revive the player after clicking "revive"
      Client.sendRevive();
      this.deathScroll.hideTween.start();
  }

  // INIT CODE

  setLatency(latency){
      this.latency = latency;
  }

  initWorld(data) { // Initialize the game world based on the server data
      AOIutils.nbAOIhorizontal = data.nbAOIhorizontal;
      AOIutils.lastAOIid = data.lastAOIid;

      this.displayHero(data.player.x,data.player.y,data.player.id);

      this.displayHUD(); // Displays HUD, and sets up life bar, chat bar, the HUD buttons and their behavior

      this.setUpPlayer(this.player,data.player);
      this.updatePlayerStatus(this.player,data.player);

      // Reorder the groups a little, so that all their elements render in the proper order
      this.moveGroupTo(this.world, this.groundMapLayers, 0);
      this.moveGroupTo(this.world, this.scenery, this.groundMapLayers.z);
      this.moveGroupTo(this.world, this.markerGroup, this.scenery.z); // z start at 1
      this.moveGroupTo(this.world, this.entities, this.markerGroup.z);
      this.moveGroupTo(this.world, this.highMapLayers, this.entities.z);
      this.moveGroupTo(this.world, this.HUD, this.highMapLayers.z);

      this.itemsTable = {};
      this.monstersTable = {};
      this.displayedPlayers = new Set();
      this.playerIsInitialized = true;
      // If the game loads while the window is out of focus, it may hang; disableVisibilityChange should be set to true
      // only once it's fully loaded
      if(document.hasFocus()){
          this.stage.disableVisibilityChange = true; // Stay alive even if window loses focus
      }else{
          this.onResume.addOnce(function(){
              this.stage.disableVisibilityChange = true;
          }, this);
      }
      // Check whether these three achievements have been fulfilled already (stored in localStorage)
      this.weaponAchievement = Client.hasAchievement(0);
      this.armorAchievement = Client.hasAchievement(4);
      this.speakAchievement = Client.hasAchievement(3);

      Client.emptyQueue(); // Process the queue of packets from the server that had to wait while the client was initializing
      this.groundMapLayers.setAll('visible',true);
      this.highMapLayers.setAll('visible',true);
      //this.scenery.setAll('visible',true);
      // Destroy loading screen
      this.loadingShade.destroy();
      this.loadingText.destroy();
      this.messageIn((this.isNewPlayer ? 'Welcome to PhaserQuest!' : 'Welcome back!' ));

      if(this.isNewPlayer) this.toggleHelp();
  }

  moveGroupTo(parent,group,endPos){
      // parent is the Phaser Group that contains the group to move (default: world)
      // group is the Phaser Group to be moved
      // endPos is the position (integer) at which to move it
      // if endPos is some group's z value, the moved group will be right below (visually) that group
      // This manipulation is needed because the rendering order and visual overlap of the sprites depend of the order of their groups
      var startPos = group.z-1;
      var diff = startPos-endPos;
      if(diff > 0){
          for(diff; diff > 0; diff--){
              parent.moveDown(group);
          }
      }else if(diff < 0){
          for(diff; diff < 0; diff++){
              parent.moveUp(group);
          }
      }
  }

  displayHero(x,y,id){
      this.player = this.newPlayer(x,y,id);
      this.player.setIsPlayer(true);
      this.player.addChild(this.cameraFocus = this.add.sprite(0, 16)); // trick to force camera offset
      this.followPlayer();
  }

  // MOVE CODE

  moveCharacter(id,end,orientation,delta) { // Move character according to information from the server
      // end is a small object containing the x and y coordinates to move to
      // orientation, between 1 and 4, indicates the orientation the character should face at the end of the movement
      // delta is the latency of the player, to adjust the speed of the movements (movements go faster as the latency increase, to make sure they don't get increasingly out of sync)
      var character = this.charactersPool[id];
      character.prepareMovement(end,orientation,{action:0},delta+this.latency,false); // false : don't send path to server
  }

  moveMonster(id,path,delta) { // Move monster according to information from the server
      // path is an array of 2-tuples of coordinates, representing the path to follow
      // delta is the latency of the player, to adjust the speed of the movements (movements go faster as the latency increase, to make sure they don't get increasingly out of sync)
      var monster = this.monstersTable[id];
      if(monster) monster.prepareMovement(path, {action: 0}, delta+this.latency);
  };

  // REMOVAL CODE

  removePlayer(player,animate){
      // animate is a boolean to indicate if the death animation should be played or not (if the player to be removed is not visible on screen, it's useless to play the animation)
      if(!player) return;
      player.die(animate);
      delete charactersPool[player.id];
  };

  // ======================

  // SCREENS CODE : Code about displaying screens of any kind

  makeAchievementsScroll() { // Create the screen displaying the achievements of the player
      var achievements = this.db.achievements;
      this.nbAchievements = Object.keys(achievements).length;
      var perPage = 4;
      this.currentAchievementsPage = 1;
      this.minAchievementsPage = 1;
      this.maxAchievementsPage = this.nbAchievements/perPage;
      this.achievementsBg = this.makeFlatScroll(this.toggleAchievements);
      var nameStyle = { // Style for achievements names
          font: '18px pixel',
          fill: "#ffffff", // f4d442
          stroke: "#000000",
          strokeThickness: 3
      };
      var descStyle = { // Style for achievements descriptions
          font: '18px pixel',
          fill: "#000000"
      };
      // Creates a mask outside of which the achievement holders won't be visible, to allow to make them slide in and out
      // of the scroll background
      var mask = this.add.graphics(0, 0);
      mask.fixedToCamera = true;
      mask.beginFill(0xffffff);
      mask.drawRect(this.achievementsBg.x+40, this.achievementsBg.y+40, this.achievementsHolderWidth-100,300);
      mask.endFill();
      var page = 0;
      // Create one "holder" per achievement, consisting in a background image, the name and the description
      this.achievementsBg.holders = [];
      for(var i = 0; i < this.nbAchievements; i++){
          if(i > 0 && i%perPage == 0) page++;
          this.achievementsBg.holders.push(this.achievementsBg.addChild(this.add.sprite(40+(page*this.achievementsHolderWidth),50+((i%4)*62),'atlas1','achievementholder')));
          this.achievementsBg.holders[i].addChild(this.add.text(75, 13, achievements[i].name, nameStyle));
          this.achievementsBg.holders[i].addChild(this.add.text(295, 15, achievements[i].desc,descStyle));
          this.achievementsBg.holders[i].mask = mask;
      }

      this.achievementsBg.leftArrow = this.achievementsBg.addChild(this.add.button(345, 315, 'atlas1',function(){
          this.changeAchievementsPage('left');
      }, this, 'arrows_2', 'arrows_2', 'arrows_4'));
      this.achievementsBg.rightArrow = this.achievementsBg.addChild(this.add.button(412, 315, 'atlas1',function(){
          this.changeAchievementsPage('right');
      }, this, 'arrows_3', 'arrows_3', 'arrows_5'));
      this.achievementsBg.leftArrow.input.useHandCursor = false;
      this.achievementsBg.rightArrow.input.useHandCursor = false;

      this.achievementsBg.completed = this.achievementsBg.addChild(this.add.text(645, 325, '', {
          font: '18px pixel',
          fill: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3
      }));
      this.updateAchievements();
      this.updateAchievementsArrows();
  };

  makeDeathScroll() { // Make the screen that is displayed when player dies
      this.deathScroll = Home.makeScroll(); // Start from a generic scroll-like screen
      Home.setFadeTweens(this.deathScroll);
      var title = this.deathScroll.addChild(this.add.text(0, 125, 'You died...',{
          font: '30px pixel',
          fill: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3
      }));
      title.x = this.deathScroll.width/2 - title.width/2;
      var button = this.deathScroll.addChild(this.add.button(0,210, 'atlas1',this.revivePlayer, this, 'revive_0', 'revive_0', 'revive_1'));
      button.x = this.deathScroll.width/2;
      button.anchor.set(0.5,0);
  };

  makeFlatScroll(callback) { // Creates and empty, generic flat scroll screen, to be used for achievements and help
      // callback is the function to call when clicking on the close button (typically a toggle function, such as toggleHelp() )
      var scroll = this.add.sprite(80,32,'atlas1','achievements');
      scroll.fixedToCamera = true;
      scroll.alpha = 0;
      scroll.visible = false;
      Home.setFadeTweens(scroll);
      var closeBtn = scroll.addChild(this.add.button(scroll.width-18, -14, 'atlas1',callback, this, 'close_1', 'close_0', 'close_2'));
      closeBtn.input.useHandCursor = false;
      return scroll;
  };

  makeHelpScroll() { // Make the screen showing how to play instructions
      this.helpScroll = this.makeFlatScroll(this.toggleHelp);
      Home.makeTitle(this.helpScroll,'How to play');
      var mouseY = 130;
      var enterY = 200;
      var charY = 270;
      var style = {font: '18px pixel'};
      var mouse = this.helpScroll.addChild(this.add.sprite(55,mouseY,'atlas1','mouse'));
      mouse.anchor.set(0.5);
      this.helpScroll.addChild(this.add.text(100,mouseY-10,this.db.texts.help_move,style));
      var enter = this.helpScroll.addChild(this.add.sprite(55,enterY,'atlas1','enter'));
      enter.anchor.set(0.5);
      this.helpScroll.addChild(this.add.text(100,enterY-12,this.db.texts.help_chat,style));
      var char = this.helpScroll.addChild(this.add.sprite(55,charY,'atlas3','clotharmor_31'));
      char.anchor.set(0.5);
      this.helpScroll.addChild(this.add.text(100,charY-10,this.db.texts.help_save,style));
  };

  // Create the screen used to prompt the player to change the orientation of his device
  makeOrientationScreen() {
      this.orientationContainer = this.add.sprite(0,0); // Create a container sprite
      // Make black screen to cover the scene
      this.orientationShade = this.orientationContainer.addChild(this.add.graphics(0, 0));
      this.orientationShade.beginFill(0x000000,1);
      this.orientationShade.drawRect(0,0,this.width,this.height);
      this.orientationShade.endFill();
      this.deviceImage = this.orientationContainer.addChild(this.add.sprite(this.width/2,this.height/2,'atlas1','device'));
      this.deviceImage.anchor.set(0.5);
      this.rotateText = this.orientationContainer.addChild(this.add.text(0, 0, this.db.texts.orient,{
          font: '40px pixel',
          fill: "#ffffff",
          stroke: "#000000",
          strokeThickness: 3
      }));
      this.rotateText.x = this.width/2 - this.rotateText.width/2;
      this.rotateText.y = this.deviceImage.y + this.deviceImage.height + 20;
      this.rotateText.style.wordWrap = true;
      this.rotateText.style.wordWrapWidth = 400;
      this.orientationContainer.fixedToCamera = true;
      this.orientationContainer.visible = false;
  };

  displayDeathScroll() { // Displayed when player dies
      if(!this.deathScroll) this.makeDeathScroll();
      this.deathScroll.visible = true;
      this.deathScroll.showTween.start();
  };

  // Display an error message if the user id in localStorage has no match in the database;
  // called when receiving the error notification from the server
  displayError() {
      this.loadingText.text = this.db.texts.db_error;
      this.loadingText.x = this.width/2 - this.loadingText.width/2;
      this.loadingText.y = this.height/2 - this.loadingText.height/2;
  };

  // Display the loading screen when the game starts, after clicking "play"
  displayLoadingScreen() {
      // Cover the screen with a black rectangle
      this.loadingShade = this.add.graphics(0, 0);
      this.loadingShade.beginFill(0x000000,1);
      this.loadingShade.drawRect(this.borderPadding,this.borderPadding,this.stage.width-(this.borderPadding*2),this.stage.height-(this.borderPadding*2));
      this.loadingShade.endFill();
      // Add some loading text (whos value is in this.db.texts) and center it
      this.loadingText = this.add.text(0, 0, this.db.texts.create,{
          font: '18px pixel',
          fill: "#ffffff", // f4d442
          stroke: "#000000",
          strokeThickness: 3
      });
      this.loadingText.x = this.width/2 - this.loadingText.width/2;
      this.loadingText.y = this.height/2 - this.loadingText.height/2;
      this.loadingText.style.wordWrap = true;
      this.loadingText.style.wordWrapWidth = 400;
  };

  // Displays the screen used to prompt the player to change the orientation of his device;
  // called by the enterIncorrectOrientation callback
  displayOrientationScreen() {
      if(!this.orientationContainer) this.makeOrientationScreen(); // Make the screen if it doesn't exist yet (it's not made until necessary)
      // Hide the help and achievements screens if they are visible
      if(this.helpScroll && this.helpScroll.visible) this.toggleHelp();
      if(this.achievementsBg && this.achievementsBg.visible) this.toggleAchievements();
      this.orientationContainer.visible = true;
  };

  // Hide the screen used to prompt the player to change the orientation of his device;
  // called by the leaveIncorrectOrientation callback
  removeOrientationScreen() {
      this.orientationContainer.visible = false;
  };

  toggleHelp() { // Toggles the visibility state of the help screen
      if(!this.helpScroll) this.makeHelpScroll();
      if(this.helpScroll.visible){
          this.helpButton.freezeFrames = false;
          this.helpButton.setFrames('helpicon_1','helpicon_0','helpicon_2');
          this.helpScroll.hideTween.start();
      }else{
          this.helpScroll.visible = true;
          this.helpButton.freezeFrames = true;
          this.helpScroll.showTween.start();
      }
  };

  toggleAchievements() { // Toggles the visibility state of the achievements screen
      if(!this.achievementsBg) this.makeAchievementsScroll();
      if(this.achievementsBg.visible){
          this.achButton.freezeFrames = false;
          this.achButton.setFrames('achievementicon_1','achievementicon_0','achievementicon_2');
          this.achievementsBg.hideTween.start();
      }else{
          this.achButton.freezeFrames = true;
          this.achievementsBg.visible = true;
          this.achievementsBg.showTween.start();
          if(this.achTween.isRunning) this.achTween.pause(); // Stops the blinking achievement icon tween
      }
  };

  updateAchievements() {
      // Check each achievement holder and, if the corresponding achievement has been acquired, update the content accordingly
      if(!this.achievementsBg) this.makeAchievementsScroll();
      var achievements = this.db.achievements;
      var completed = 0;
      for(var i = 0; i < this.nbAchievements; i++){
          var owned = Client.hasAchievement(i);
          if(owned) completed++;
          if(owned) {
              this.achievementsBg.holders[i].addChild(this.add.sprite(0, 0, 'atlas1','tokens_'+achievements[i].token));
              this.achievementsBg.holders[i].getChildAt(0).addColor("#f4d442",0);
          }
      }
      this.achievementsBg.completed.text = 'Completed '+completed+'/'+this.nbAchievements;
  };

  changeAchievementsPage(dir) {
      // dir is a string that indicates if the right or left arrow was clicked
      if(dir == 'right' && this.currentAchievementsPage == this.maxAchievementsPage) return;
      if(dir == 'left' && this.currentAchievementsPage == this.minAchievementsPage) return;
      var sign = (dir == 'right' ? -1 : 1);
      for(var i = 0; i < this.achievementsBg.holders.length; i++){
          var holder = this.achievementsBg.holders[i];
          var tween = this.add.tween(holder);
          tween.to({x: holder.x+(sign*this.achievementsHolderWidth)}, Phaser.Timer.SECOND*0.4);
          tween.start();
      }
      this.currentAchievementsPage += -1*sign;
      this.updateAchievementsArrows();
  };

  updateAchievementsArrows() {
      if(this.currentAchievementsPage == this.maxAchievementsPage){
          this.achievementsBg.rightArrow.setFrames('arrows_1','arrows_1','arrows_1');
      }else{
          this.achievementsBg.rightArrow.setFrames('arrows_3','arrows_3','arrows_5');
      }
      if(this.currentAchievementsPage == this.minAchievementsPage){
          this.achievementsBg.leftArrow.setFrames('arrows_0','arrows_0','arrows_0');
      }else{
          this.achievementsBg.leftArrow.setFrames('arrows_2','arrows_2','arrows_4');
      }
  };

  // ==============

  // ACHIEVEMENTS CODE : Code about handling achievements

  handleLootAchievement(id) { // item id
      var item = this.itemsInfo[this.itemsIDmap[id]];
      if(item.type !== undefined){
          if(item.type == 1 && !this.weaponAchievement){
              this.getAchievement(0);
              this.weaponAchievement = true;
          }else if(item.type == 2 && !this.armorAchievement){
              this.getAchievement(4);
              this.armorAchievement = true;
          }
      }
  };

  this.handleSpeakAchievement = function() {
      this.getAchievement(3);
      this.speakAchievement = true;
  };

  handleKillAchievement(id) { // monster id
      var nbKilled =  localStorage.getItem('killed_'+id);
      if(nbKilled === undefined) nbKilled = 0;
      nbKilled++;
      localStorage.setItem('killed_'+id,nbKilled);
      var aid = this.monstersInfo[this.monstersIDmap[id]].achievement;
      if(this.db.achievements[aid] && nbKilled >= this.db.achievements[aid].nb && !Client.hasAchievement(aid)) this.getAchievement(aid);
  };

  handleLocationAchievements() {
      if(this.inDoor || !this.locationAchievements.length) return;
      var pos = this.computeTileCoords(this.player.x,this.player.y);
      for(var i = this.locationAchievements.length-1; i >= 0 ; i--){
          var area = this.locationAchievements[i];
          if((area.criterion == "in" && area.contains(pos.x,pos.y)) || (area.criterion == "out" && !area.contains(pos.x,pos.y))){
              this.getAchievement(area.achID);
              this.locationAchievements.splice(i,1);
          }
      }
  };

  getAchievement(id) { // achievement id
      Client.setAchievement(id);
      this.sounds.play('achievement');
      this.achButton.blink = false;
      if(!this.achTween.isRunning) this.achTween.start();
      if(this.achTween.isPaused) this.achTween.resume();
      this.achBar.visible = true;
      this.achBar.upTween.start();
      this.achBar.achName.text = this.db.achievements[id].name;
      this.achBar.achName.x = Math.floor((this.achBar.width/2) - (this.achBar.achName.width/2));
      this.updateAchievements();
  };

  findLocationAchievements() {
      this.locationAchievements = [];
      Object.keys(this.db.achievements).forEach(function(achID){
          if(Client.hasAchievement(achID)) return;
          var ach = this.db.achievements[achID];
          if(ach.locationAchievement) {
              var area = new Phaser.Rectangle(ach.rect.x,ach.rect.y,ach.rect.w,ach.rect.h);
              area.criterion = ach.criterion;
              area.achID = achID;
              this.locationAchievements.push(area);
          }
      });
  };

  // =======================
  // POS CODE : Code for position and camera-related computations

  // Determines if two entities (a and b) are on the same cell (returns -1), on adjacent (non-diagonal) cells (returns a value between
  // 1 and 4 corresponding to the orientation of a with respect to b) or further apart (returns 0)
  adjacent(a,b) {
      if(!a || !b) return 0;
      var posA = this.computeTileCoords(a.x, a.y);
      var posB = this.computeTileCoords(b.x, b.y);
      var Xdiff = posA.x-posB.x;
      var Ydiff = posA.y-posB.y;
      if(Xdiff == 1 && Ydiff == 0){
          return 1;
      }else if(Xdiff == 0 && Ydiff == 1) {
          return 2;
      }else if(Xdiff == -1 && Ydiff == 0){
          return 3;
      }else if(Xdiff == 0 && Ydiff == -1) {
          return 4;
      }else if(Xdiff == 0 && Ydiff == 0){ // The two entities are on the same cell
          return -1;
      }else{ // The two entities are not on adjacent cells, nor on the same one
          return 0;
      }
  };

  // Fetches the first element from the space map at the proived coordinates
  detectElement(map,x,y) {
      // map is the spaceMap in which to look
      var cell = this.computeTileCoords(x,y);
      return map.getFirst(cell.x,cell.y);
  };

  // Compute the orientation that the player must have to go to the last cell of its path (used when the last cell is occupied by something and the past has to be "shortened" by one cell)
  computeFinalOrientation(path) { // path is a list of cells
      // path is an array of 2-tuples of coordinates
      var last = path[path.length-1];
      var beforeLast =  path[path.length-2];
      if(last.x < beforeLast.x){
          return 1;
      }else if(last.y < beforeLast.y){
          return 2;
      }else if(last.x > beforeLast.x){
          return 3;
      }else if(last.y > beforeLast.y){
          return 4;
      }
  };

  // Convert pixel coordinates into tiles coordinates (e.g. 96, 32 becomes 3, 1)
  computeTileCoords(x,y) {
      var layer = this.map.gameLayers[0];
      return new Phaser.Point(layer.getTileX(x),layer.getTileY(y));
  };

  // Returns the rectangle corresponding to the view of the camera (not counting HUD, the actual view of the world)
  computeView() {
      this.view = new Phaser.Rectangle(this.camera.x + this.borderPadding, this.camera.y + this.borderPadding,
          this.camera.width - this.borderPadding*2, this.camera.height - this.borderPadding*2 - this.HUDheight);
  };

  checkCameraBounds() {
      // Due to the shape of the map, the bounds of the camera cannot always be the same; north of some Y coordinate (this.mapWideningY),
      // the width of the bounds has to increase, from 92 to 113.
      var pos = this.computeTileCoords(this.player.x,this.player.y);
      if(this.cameraFollowing && pos.y <= this.mapWideningY && this.camera.bounds.width == 92*this.map.tileWidth){
          this.tweenCameraBounds(113);
      }else if(this.cameraFollowing && pos.y > this.mapWideningY && this.camera.bounds.width == 113*this.map.tileWidth){
          this.tweenCameraBounds(92);
      }
  };

  tweenCameraBounds(width) {
      // width is the width in pixels of the camera bounds that should be tweened to
      var tween = this.add.tween(this.camera.bounds);
      tween.to({width: width*this.map.tileWidth}, 1500,null, false, 0);
      tween.start();
  };

  followPlayer() { // Make the camera follow the player, within the appropriate bounds
      this.inDoor = false;
      // Rectangle to which the camera is bound, cannot move outside it
      var width = (this.player.x >= 92 ? 113 : 92);
      this.camera.bounds = new Phaser.Rectangle(this.map.tileWidth-this.borderPadding,this.map.tileWidth-this.borderPadding,width*this.map.tileWidth,311*this.map.tileWidth);
      this.camera.follow(this.cameraFocus);
      this.cameraFollowing = true;
  };

  followPlayerIndoors(x,y,mx,my) { // Follow player but with extra constraints due to being indoors
      // x and y are the coordinates in tiles of the top left corner of the rectangle in which the camera can move
      // mx and my are the coordinates in tiles of the bottom right corner of that same rectangle
      this.inDoor = true;
      this.camera.follow(this.cameraFocus);
      if(x && y && mx && my) {
          var w = Math.max((mx - x)*this.map.tileWidth,this.width);
          var h = (my - y)*this.map.tileHeight;
          this.camera.bounds = new Phaser.Rectangle(x*this.map.tileWidth,y*this.map.tileHeight,w,h);
      }else{
          this.camera.bounds = new Phaser.Rectangle(this.map.tileWidth - this.borderPadding, this.map.tileWidth - this.borderPadding, 170 * this.map.tileWidth, 311 * this.map.tileWidth);
      }
      this.cameraFollowing = true;
  };

  unfollowPlayer() { // Make the camera stop following player, typically because he is in a small indoors area
      this.inDoor = true;
      this.camera.unfollow();
      this.camera.bounds = null;
      this.cameraFollowing = false;
  };

  // =============
  // Sounds-related code

  addSounds() {
      // Slices the audio sprite based on the markers positions fetched from the JSON
      var markers = this.db.sounds;
      this.sounds = this.add.audio('sounds');
      this.sounds.allowMultiple = true;
      Object.keys(markers.spritemap).forEach(function(sound){
          var sfx = markers.spritemap[sound];
          this.sounds.addMarker(sound, sfx.start, sfx.end-sfx.start);
      });
  };

  //===================
  // Animations-related code

  // Sets up basic, single-orientation animations for scenic animated sprites
  basicAnimation(sprite) { // sprite is the sprite to which the animation should be applied
      var frames = [];
      for(var m = 0; m < sprite.nbFrames; m++){ // Generate the list of frames of the animations based on the initial frame and the total number of frames
          frames.push(sprite.frame+m);
      }
      sprite.animations.add('idle', frames, sprite.rate, true);
      sprite.animations.play('idle');
  };

  // Same but using atlas frames
  basicAtlasAnimation(sprite) { // sprite is the sprite to which the animation should be applied
      // sprite, nbFrames, ... are absorbed from npc.json when a new NPC() is created
      sprite.animations.add('idle', Phaser.Animation.generateFrameNames(sprite.atlasKey+'_', 0, 0+sprite.nbFrames-1), sprite.rate, true);
      sprite.animations.play('idle');
  };

  //======================
  // HUD CODE: HUD-related code

  this.displayHUD = function() {
      var lifeX = this.borderPadding;
      var lifeY = this.height - this.borderPadding - this.HUDheight + 6;
      this.barY = this.height - this.borderPadding - this.HUDheight;

      this.HUDbuttons = this.add.group();

      this.displayChatBar();
      this.displayAchievementDock();

      this.HUD.add(this.add.sprite(this.borderPadding, this.barY, 'atlas1','bar'));
      this.HUD.add(this.weaponIcon = this.add.sprite(this.borderPadding + 210, this.barY, 'atlas3'));
      this.HUD.add(this.armorIcon = this.add.sprite(this.borderPadding + 244, this.barY + 3,'atlas3'));

      this.HUDmessage = null;
      this.messages = this.add.group();
      for(var m = 0; m < 4; m++){
          this.messages.add(this.add.text(490, this.barY+5, '', {
              font: '16px pixel',
              fill: "#eeeeee"
          }));
      }
      this.messages.setAll('fixedToCamera', true);
      this.messages.setAll("anchor.x",0.5);
      this.messages.setAll("exists",false);

      this.nbConnectedText = this.HUD.add(this.add.text(745, this.barY+8, '0 players', {
          font: '16px pixel',
          fill: "#eeeeee"
      }));

      this.chatButton = this.HUDbuttons.add(this.add.button(850, this.barY + 2, 'atlas1', this.toggleChat, this, 'talkicon_1', 'talkicon_0', 'talkicon_2'));
      this.achButton = this.HUDbuttons.add(this.add.button(880, this.barY + 2, 'atlas1',this.toggleAchievements, this, 'achievementicon_1', 'achievementicon_0', 'achievementicon_2'));
      this.helpButton = this.HUDbuttons.add(this.add.button(910, this.barY + 2, 'atlas1', this.toggleHelp, this, 'helpicon_1', 'helpicon_0', 'helpicon_2'));
      this.HUDbuttons.add(this.add.button(940, this.barY + 2, 'atlas1', function (_btn) {
          if(!this.sound.mute){
              _btn.setFrames('soundicon_1','soundicon_0','soundicon_1');
          }else if(this.sound.mute){
              _btn.setFrames('soundicon_2','soundicon_2','soundicon_2');
          }
          this.sound.mute = !this.sound.mute;
      }, this, 'soundicon_2', 'soundicon_2','soundicon_2'));

      // Set up the blinking tween that triggers when a new achievement is unlocked
      this.achTween = this.add.tween(this.achButton);
      // will blink every 500ms
      this.achTween.to({},500,null, false, 0,-1); // -1 to loop forever
      this.achTween.onLoop.add(function(btn){
          btn.blink = !btn.blink;
          if(btn.blink){
              this.achButton.setFrames('achievementicon_3','achievementicon_3','achievementicon_3');
          }else{
              this.achButton.setFrames('achievementicon_1','achievementicon_0','achievementicon_2');
          }
      }, this);

      this.createLifeBar(lifeX, lifeY);
      this.HUD.add(this.health);
      this.HUD.add(this.add.sprite(lifeX, lifeY, 'atlas1','life'));
      this.HUD.add(this.HUDbuttons);
      this.HUD.setAll('fixedToCamera', true);
      this.HUDbuttons.forEach(function (button) {
          button.input.useHandCursor = false;
      });

      var chatKey = this.input.keyboard.addKey(Phaser.Keyboard.ENTER);
      chatKey.onDown.add(this.toggleChat, this);
  };

  displayChatBar() {
      this.chatBar = this.HUD.add(this.add.sprite(96, this.barY+1, 'atlas1', 'chatbar'));
      this.chatBar.visible = false;
      this.chatBar.upTween = this.add.tween(this.chatBar.cameraOffset);
      this.chatBar.downTween = this.add.tween(this.chatBar.cameraOffset);
      this.chatBar.upTween.to({y: this.barY-30}, Phaser.Timer.SECOND/5);
      this.chatBar.downTween.to({y: this.barY+1}, Phaser.Timer.SECOND/5);
      this.chatBar.downTween.onComplete.add(function(){
          this.chatBar.visible = false;
      },this);
      this.chatBar.upTween.onComplete.add(function(){
          this.chatInput.focusOutOnEnter = true;
      },this);
      this.chatInput = this.HUD.add(this.add.inputField(115, this.barY-20,{
          width: 750,
          height: 18,
          fillAlpha: 0,
          cursorColor: '#fff',
          fill: '#fff',
          font: '14px pixel',
          max: this.maxChatLength
      }));
      this.chatInput.visible = false;
      this.chatInput.focusOutOnEnter = false;
      this.chatInput.input.useHandCursor = false;
  };

  displayAchievementDock() {
      this.achBar = this.HUD.add(this.add.sprite(274, this.barY+1, 'atlas1', 'newach'));
      this.achBar.visible = false;
      this.achBar.upTween = this.add.tween(this.achBar.cameraOffset);
      this.achBar.downTween = this.add.tween(this.achBar.cameraOffset);
      this.achBar.upTween.to({y: this.barY-68}, Phaser.Timer.SECOND/5);
      this.achBar.downTween.to({y: this.barY+1}, Phaser.Timer.SECOND/5,null,false,Phaser.Timer.SECOND*5);
      this.achBar.downTween.onComplete.add(function(){
          this.achBar.visible = false;
      },this);
      this.achBar.upTween.onComplete.add(function(){
          this.achBar.downTween.start();
      },this);
      this.achBar.addChild(this.add.sprite(192, -35, 'atlas1', 'tokens_0'));
      var sparks = this.achBar.addChild(this.add.sprite(192,-35, 'atlas1','achsparks_0'));
      var frames = Phaser.Animation.generateFrameNames('achsparks_', 0, 5);
      sparks.animations.add('glitter', frames, 7, true);
      sparks.play('glitter');
      var titleStyle = {
          font: '14px pixel',
          fill: "#f4d442",
          stroke: "#000000",
          strokeThickness: 3
      };
      var nameStyle = {
          font: '16px pixel',
          fill: "#ffffff", // f4d442
          stroke: "#000000",
          strokeThickness: 3
      };
      this.achBar.addChild(this.add.text(133, 20, 'New Achievement Unlocked!',titleStyle));
      this.achBar.achName = this.achBar.addChild(this.add.text(133, 40, 'A true Warrior!',nameStyle));
  };

  computeLifeBarWidth() {
      // Based on the amount of life the player has, compute how many pixels wide the health bar should be
      return Math.max(this.healthBarWidth*(this.player.life/this.player.maxLife),1);
  };

  createLifeBar(lifeX,lifeY) {
      // lifeX and lifeY are the coordinates in pixels where the life bar should be displayed at on the screen
      var width = this.computeLifeBarWidth();
      this.health = this.add.sprite(lifeX+20,lifeY+4);
      this.health.addChild(this.add.tileSprite(0,0, width, 18,'life',0));
      this.health.addChild(this.add.sprite(width,0,'life',1));
  };

  createMarker() { // Creates the white marker that follows the pointer
      this.markerGroup = this.add.group();
      this.marker = this.markerGroup.add(this.add.sprite(0,0, 'atlas1'));
      this.marker.alpha = 0.5;
      this.marker.canSee = true;
      this.marker.collide = false;
      this.canvas.style.cursor = this.cursor;
  };

  updateMarker(x,y,collide) { // Makes the marker white or red depending on whether the underlying tile is collidable
      // collide is the boolean indicating if the tile is a collision tile or not
      this.marker.position.set(x,y);
      this.marker.frameName = (collide ? 'marker_1' : 'marker_0');
      this.marker.collide = collide;
  };

  messageIn(txt) { // Slide a message in the message area of the HUD
      // txt is the string to display in the message area
      var msg = this.messages.getFirstExists(false);
      msg.exists = true;
      msg.alpha = 0;
      msg.text = txt;
      msg.cameraOffset.y = this.barY+20;
      var yTween = this.add.tween(msg.cameraOffset);
      var alphaTween = this.add.tween(msg);
      yTween.to({y: this.barY+8}, Phaser.Timer.SECOND/5);
      alphaTween.to({alpha: 1}, Phaser.Timer.SECOND/5);
      yTween.start();
      alphaTween.start();
      if(this.HUDmessage) this.messageOut(this.HUDmessage);
      this.HUDmessage = msg;
      var outTween = this.add.tween(msg);
      outTween.to({}, Phaser.Timer.SECOND*3);
      outTween.onComplete.add(this.messageOut,this);
      outTween.start();
  };

  messageOut(msg) { // Slide a message in the message area of the HUD
      // msg is the text object to move out
      var yTween = this.add.tween(msg.cameraOffset);
      var alphaTween = this.add.tween(msg);
      yTween.to({y: this.barY}, Phaser.Timer.SECOND/5);
      alphaTween.to({alpha: 0}, Phaser.Timer.SECOND/5);
      yTween.start();
      alphaTween.start();
      alphaTween.onComplete.add(function(txt){
          txt.exists = false;
      },this);
      this.HUDmessage = null;
  };

  toggleChat() { // Toggles the visibility of the chat bar
      if(this.chatBar.visible){ // Hide bar
          this.chatButton.frameName = 'talkicon_0';
          this.chatButton.freezeFrames = false;
          this.chatInput.focusOutOnEnter = false;
          this.chatInput.visible = false;
          this.chatInput.endFocus();
          this.chatBar.downTween.start();
          if (this.chatInput.text.text) { // If a text has been typed, send it
              var txt = this.chatInput.text.text;
              this.player.displayBubble(txt);
              Client.sendChat(txt);
          }
          this.chatInput.resetText();
      }else{ // Show bar
          this.chatButton.frameName = 'talkicon_2';
          this.chatButton.freezeFrames = true;
          this.chatBar.visible = true;
          this.chatInput.visible = true;
          this.chatInput.startFocus();
          this.chatBar.upTween.start();
      }
  };

  updateNbConnected(nb) {
      if(!this.nbConnectedText) return;
      this.nbConnected = nb;
      this.nbConnectedText.text = this.nbConnected+' player'+(this.nbConnected > 1 ? 's' : '');
  };

  // ===========================
  // MAP CODE : Map & NPC-related code

  displayMap() {
      this.groundMapLayers = this.add.group();
      this.highMapLayers = this.add.group();
      this.map = this.add.tilemap('map');
      this.map.addTilesetImage('tilesheet', 'tileset');
      this.map.gameLayers = [];
      for(var i = 0; i < this.map.layers.length; i++) {
          var group = (i <= this.nbGroundLayers-1 ? this.groundMapLayers : this.highMapLayers);
          this.map.gameLayers[i] = this.map.createLayer(this.map.layers[i].name,0,0,group);
          this.map.gameLayers[i].visible = false; // Make map invisible before the game has fully loaded
      }
      this.map.gameLayers[0].inputEnabled = true; // Allows clicking on the map
      this.map.gameLayers[0].events.onInputUp.add(this.handleMapClick, this);
      this.createDoorsMap(); // Create the associative array mapping coordinates to doors/teleports

      //this.world.resize(this.map.widthInPixels,this.map.heightInPixels);
      this.world.setBounds(0,0,this.map.widthInPixels,this.map.heightInPixels);

      this.map.tileset = {
          gid: 1,
          tileProperties: this.map.tilesets[0].tileProperties
      };

      this.createCollisionArray();
  };

  createCollisionArray() {
      // Create the grid used for pathfinding ; it consists in a 2D array of 0's and 1's, 1's indicating collisions
      this.collisionArray = [];
      for(var y = 0; y < this.map.height; y++){
          var col = [];
          for (var x = 0; x < this.map.width; x++) {
              var collide = false;
              for (var l = 0; l < this.map.gameLayers.length; l++) {
                  var tile = this.map.getTile(x, y, this.map.gameLayers[l]);
                  if (tile) {
                      // The original BrowserQuest Tiled file doesn't use a collision layer; rather, properties are added to the
                      // tileset to indicate which tiles causes collisions or not. Which is why we have to check in the tileProperties
                      // if a given tile has the property "c" or not (= collision)
                      var tileProperties = this.map.tileset.tileProperties[tile.index - this.map.tileset.gid];
                      if (tileProperties) {
                          if (tileProperties.hasOwnProperty('c')) {
                              collide = true;
                              break;
                          }
                      }
                  }
              }
              col.push(+collide); // "+" to convert boolean to int
          }
          this.collisionArray.push(col);
      }

      this.easystar.setGrid(this.collisionArray);
      this.easystar.setAcceptableTiles([0]);
  };

  createDoorsMap() { // Create the associative array mapping coordinates to doors/teleports
      this.doors = new spaceMap();
      for (var d = 0; d < this.map.objects.doors.length; d++) {
          var door = this.map.objects.doors[d];
          var position = this.computeTileCoords(door.x, door.y);
          this.doors.add(position.x, position.y, {
              to: new Phaser.Point(door.properties.x * this.map.tileWidth, door.properties.y * this.map.tileWidth), // Where does the door teleports to
              camera: (door.properties.hasOwnProperty('cx') ? new Phaser.Point(door.properties.cx * this.map.tileWidth, door.properties.cy * this.map.tileWidth): null), // If set, will lock the camera at these coordinates (use for indoors locations)
              orientation: door.properties.o, // What should be the orientation of the player after teleport
              follow: door.properties.hasOwnProperty('follow'), // Should the camera keep following the player, even if indoors (automatically yes if outdoors)
              // Below are the camera bounds in case of indoors following
              min_cx: door.properties.min_cx,
              min_cy: door.properties.min_cy,
              max_cx: door.properties.max_cx,
              max_cy: door.properties.max_cy
          });
      }
  };

  displayScenery() {
      var scenery = this.db.scenery.scenery;
      this.groundMapLayers.forEach(function(layer){
          for(var k = 0; k < scenery.length; k++) {
              this.map.createFromTiles(this.map.tileset.gid+scenery[k].id, -1, // tile id, replacemet
                  'tileset',layer,// key of new sprite, layer
                  this.scenery, // group added to
                  {
                      frame: scenery[k].frame,
                      nbFrames: scenery[k].nbFrames,
                      rate: 2
                  });
          }
      });
      this.scenery.setAll('visible',false);
      this.scenery.forEach(this.basicAnimation,this);
  };

  this.displayNPC = function() {
      var entities = this.cache.getJSON('entities'); // mapping from object IDs to sprites, the sprites being keys for the appropriate json file
      for (var e = 0; e < this.map.objects.entities.length; e++) {
          var object = this.map.objects.entities[e];
          if (!entities.hasOwnProperty(object.gid - 1961)) continue; // 1961 is the starting ID of the npc tiles in the map ; this follows from how the map was made in the original BrowserQuest
          var entityInfo = entities[object.gid - 1961];
          if(entityInfo.npc) this.basicAtlasAnimation(this.entities.add(new NPC(object.x, object.y, entityInfo.sprite)));
      }
  };

  // ===========================
  // Mouse and click-related code

  enableClick() {
      this.clickEnabled = true;
  };

  this.disableClick = function() {
      this.clickEnabled = false;
  };

  handleClick() {
      // If click is enabled, return true to the calling function to allow player to click,
      // then disable any clicking for time clickDelay
      if (this.clickEnabled){
          // re-enable the click after time clickDelay has passed
          this.time.events.add(this.clickDelay, this.enableClick, this);
          this.disableClick();
          return true;
      }
      return false;
  };

  handleCharClick(character) { // Handles what happens when clicking on an NPC
      if (this.handleClick()) {
          // character is the sprite that was clicked
          var end = this.computeTileCoords(character.x, character.y);
          end.y++; // So that the player walks to place himself in front of the NPC
          // NPC id to keep track of the last line said to the player by each NPC; since there can be multiple identical NPC
          // (e.g. the guards), the NPC ids won't do ; however, since there can be only one NPC at a given location, some
          // basic "hash" of its coordinates makes for a unique id, as follow
          var cid = character.x + '_' + character.y;
          // this.player.dialoguesMemory keeps track of the last line (out of the multiple an NPC can say) that a given NPC has
          // said to the player; the following finds which one it is, and increment it to display the next one
          var lastline;
          if (this.player.dialoguesMemory.hasOwnProperty(cid)) {
              // character.dialogue is an array of all the lines that an NPC can say. If the last line said is the last
              // of the array, then assign -1, so that no line will be displayed at the next click (and then it will resume from the first line)
              if (this.player.dialoguesMemory[cid] >= character.dialogue.length) this.player.dialoguesMemory[cid] = -1;
          } else {
              // If the player has never talked to the NPC, start at the first line
              this.player.dialoguesMemory[cid] = 0;
          }
          lastline = this.player.dialoguesMemory[cid]++; // assigns to lastline, then increment
          var action = {
              action: 1, // talk
              id: cid,
              text: (lastline >= 0 ? character.dialogue[lastline] : ''), // if -1, don't display a bubble
              character: character
          };
          this.player.prepareMovement(end, 2, action, 0, true); // true : send path to server
      };
  };

  handleChestClick(chest) { // Handles what happens when clicking on a chest
      if (this.handleClick()) {
          // chest is the sprite that was clicked
          var end = this.computeTileCoords(chest.x, chest.y);
          var action = {
              action: 4, // chest
              x: end.x,
              y: end.y
          };
          this.player.prepareMovement(end, 0, action, 0, true); // true : send path to server
      }
  };

  handleLootClick(loot) { // Handles what happens when clicking on an item
      if (this.handleClick()) {
          // loot is the sprite that was clicked
          this.player.prepareMovement(this.computeTileCoords(loot.x, loot.y), 0, {action: 0}, 0, true); // true : send path to server
      }
  };

  handleMapClick(layer,pointer) { // Handles what happens when clicking on an empty tile to move
      if (this.handleClick()) {
          // layer is the layer object that was clicked on, pointer is the mouse
          if (!this.marker.collide && this.view.contains(pointer.worldX, pointer.worldY)) { // To avoid trigger movement to collision cells or cells below the HUD
              var end = this.computeTileCoords(this.marker.x, this.marker.y);
              this.player.prepareMovement(end, 0, {action: 0}, 0, true); // true : send path to server
          }
      }
  };

  handleMonsterClick(monster) { // Handles what happens when clicking on a monster
      if (this.handleClick()) {
          // monster is the sprite that was clicked on
          var end = this.computeTileCoords(monster.x, monster.y);
          var action = {
              action: 3, // fight
              id: monster.id
          };
          this.player.prepareMovement(end, 0, action, 0, true); // true : send path to server
      }
  };

  manageMoveTarget(x,y) {
      // The move target is the green animated square that appears where the player is walking to.
      // This function takes care of displaying it or hiding it.
      var targetX = x * this.map.tileWidth;
      var targetY = y * this.map.tileWidth;
      if(this.moveTarget) {
          this.moveTarget.visible = true;
          this.moveTarget.x = targetX;
          this.moveTarget.y = targetY;
      }else{
          this.moveTarget = this.markerGroup.add(this.add.sprite(targetX, targetY, 'atlas1'));
          this.moveTarget.animations.add('rotate', Phaser.Animation.generateFrameNames('target_', 0, 3), 15, true);
          this.moveTarget.animations.play('rotate');
      }
      this.marker.visible = false;
  };

  setHoverCursors(sprite,cursor) { // Sets the appearance of the mouse cursor when hovering a specific sprite
      // sprite is the sprite that to apply the hover to
      // cursor is the url of the image to use as a cursor
      sprite.inputEnabled = true;
      sprite.events.onInputOver.add(function () {
          this.canvas.style.cursor = cursor;
          this.marker.canSee = false; // Make the white position marker invisible
      }, this);
      sprite.events.onInputOut.add(function () {
          this.canvas.style.cursor = this.cursor;
          this.marker.canSee = true;
      }, this);
      sprite.events.onDestroy.add(function(){ // otheriwse, if sprite is destroyed while the cursor is above it, it'll never fire onInputOut!
          this.canvas.style.cursor = this.cursor;
          this.marker.canSee = true;
      },this);
  };

  resetHoverCursors(sprite) {
      // sprite is the sprite whose hover events have to be purged
      sprite.events.onInputOver.removeAll();
      sprite.events.onInputOut.removeAll();
  };

  // ===================
  // Speech bubbles and HP code (stuff that appears above players)

  // dictionary of the fill and stroke colors to use to display different kind of HP
  var colorsDict = {
      'heal': {
          fill: "#00ad00",
          stroke: "#005200"
      },
      'hurt':{
          fill: '#ad0000',
          stroke: '#520000'
      },
      'hit':{
          fill: '#ffffff',
          stroke: '#000000'
      }
  };

  makeHPtexts() { // Create a pool of HP texts to (re)use when needed during the game
      this.HPGroup = this.add.group();
      for(var b = 0; b < 60; b++){
          this.HPGroup.add(this.add.text(0, 0, '', {
              font: '20px pixel',
              strokeThickness: 2
          }));
      }
      this.HPGroup.setAll('exists',false);
  };

  displayHP(txt,color,target,delay) { // Display hit points above a sprite
      // txt is the value to display
      // target is the sprite above which the hp should be displayed
      // delay is the amount of ms to wait before tweening the hp
      var hp = this.HPGroup.getFirstExists(false); // Get HP from a pool instead of creating a new object
      hp.text = txt;
      hp.fill = colorsDict[color].fill;
      hp.stroke = colorsDict[color].stroke;
      hp.lifespan = Phaser.Timer.SECOND * 2; // Disappears after 2sec
      hp.alpha = 1;
      hp.x = target.x + 10;
      hp.y = target.y-30;
      var tween = this.add.tween(hp);
      tween.to({y:hp.y-25,alpha: 0}, Phaser.Timer.SECOND * 2,null, false, delay);
      tween.start();
      hp.exists = true;
  };

  playerSays(id,txt) {
      // Display the chat messages received from the server above the players
      // txt is the string to display in the bubble
      var player = this.charactersPool[id];
      player.displayBubble(txt);
  };

  makeBubble() { // Create a speech bubble
      var bubble = this.add.sprite(0,0);
      bubble.addChild(this.add.sprite(0,0, 'bubble',0)); // Top left corner
      bubble.addChild(this.add.tileSprite(this.speechBubbleCornerSize,0,0,this.speechBubbleCornerSize, 'bubble',1)); // top side
      bubble.addChild(this.add.sprite(0,0, 'bubble',2)); // top right corner

      bubble.addChild(this.add.tileSprite(0,this.speechBubbleCornerSize,this.speechBubbleCornerSize,0, 'bubble',3)); // left side
      bubble.addChild(this.add.tileSprite(this.speechBubbleCornerSize,this.speechBubbleCornerSize,0,0, 'bubble',4)); // center
      bubble.addChild(this.add.tileSprite(0,this.speechBubbleCornerSize,this.speechBubbleCornerSize,0, 'bubble',5)); // right side

      bubble.addChild(this.add.sprite(0,0, 'bubble',6)); // bottom left corner
      bubble.addChild(this.add.tileSprite(this.speechBubbleCornerSize,0,0,this.speechBubbleCornerSize, 'bubble',7)); // bottom side
      bubble.addChild(this.add.sprite(0,0, 'bubble',8)); // bottom right corner
      bubble.addChild(this.add.sprite(0,0, 'atlas1','tail')); // tail
      var txt = bubble.addChild(this.add.text(0,0, '', {
          font: '14px pixel',
          fill: "#ffffff",
          stroke: "#000000",
          strokeThickness: 2
      }));
      txt.maxWidth = 200;
      txt.alpha = 1.5;
      return bubble;
  };

  // ================================
  // Main update code

  markerHasMoved() {
      return (this.previousMarkerPosition.x != this.markerPosition.x || this.previousMarkerPosition.y != this.markerPosition.y);
  };

  sortEntities() { // Sort the members of the "entities" group according to their y value, so that they overlap nicely
      this.entities.sort('y', Phaser.Group.SORT_ASCENDING);
  };

  update() { // Main update loop of the client
      if(!this.playerIsInitialized) return;
      var cell = this.computeTileCoords(this.input.activePointer.worldX, this.input.activePointer.worldY);
      this.markerPosition.x = cell.x * this.map.tileWidth;
      this.markerPosition.y = cell.y * this.map.tileWidth;

      if(this.chatInput.visible && !this.chatInput.focus) this.toggleChat(); // Trick to make the chat react to pressing "enter"

      if(this.player.hasMoved()) this.checkCameraBounds();

      if(this.markerHasMoved()) {
          this.computeView();
          this.marker.visible = (this.marker.canSee && this.view.contains(this.markerPosition.x,this.markerPosition.y));

          if (this.marker.visible) { // Check if the tile below the marker is collidable or not, and updae the marker accordingly
              //var tiles = [];
              var collide = false;
              for (var l = 0; l < this.map.gameLayers.length; l++) {
                  var tile = this.map.getTile(cell.x, cell.y, this.map.gameLayers[l]);
                  if (tile) {
                      //tiles.push(tile.index);
                      var tileProperties = this.map.tileset.tileProperties[tile.index - this.map.tileset.gid];
                      if (tileProperties) {
                          if (tileProperties.hasOwnProperty('c')) {
                              collide = true;
                              break;
                          }
                      }
                  }
              }
              //console.log(tiles);

              this.updateMarker(this.markerPosition.x, this.markerPosition.y, collide);
              this.previousMarkerPosition.set(this.markerPosition.x, this.markerPosition.y);
          }
      }
  };

  render() { // Use to display debug information, not used in production
      /*this.debug.cameraInfo(this.camera, 32, 32);
      this.entities.forEach(function(sprite){
          this.debug.spriteBounds(sprite);
      },this);
      this.debug.spriteBounds(this.player);
      this.debug.text(this.time.fps || '--', 2, 14, "#00ff00");*/
  }


}

// used to map the orientation of the player, stored as a number, to the actual name of the orientation
// (used to select the right animations to play, by name)
var orientationsDict = {
    1: 'left',
    2: 'up',
    3: 'right',
    4: 'down'
};
