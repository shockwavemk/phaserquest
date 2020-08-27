class Demo extends Phaser.Scene {
   preload ()
  {
      this.load.html('nameform', 'assets/text/nameform.html');
      this.load.atlas('cards', 'assets/sprites/atlas1.png', 'assets/sprites/atlas1.json');
      this.load.plugin('rexvirtualjoystickplugin', 'https://raw.githubusercontent.com/rexrainbow/phaser3-rex-notes/master/dist/rexvirtualjoystickplugin.min.js', true);
  }

   create ()
  {
      //  Create a stack of random cards

      var frames = this.textures.get('cards').getFrameNames();

      var x = 100;
      var y = 100;

      for (var i = 0; i < 64; i++)
      {
          var image = this.add.image(x, y, 'cards', Phaser.Math.RND.pick(frames)).setInteractive({ draggable: true });

          x += 4;
          y += 4;
      }

      this.input.on('dragstart', function (pointer, gameObject) {

          this.children.bringToTop(gameObject);

      }, this);

      this.input.on('drag', function (pointer, gameObject, dragX, dragY) {

          gameObject.x = dragX;
          gameObject.y = dragY;

      });

      var text = this.add.text(100, 10, 'Please enter your name', { color: 'white', fontSize: '20px '});

      var element = this.add.dom(200, 0).createFromCache('nameform');

      element.addListener('click');

      element.on('click', function (event) {

          if (event.target.name === 'playButton')
          {
              var inputText = this.getChildByName('nameField');

              //  Have they entered anything?
              if (inputText.value !== '')
              {
                  //  Turn off the click events
                  this.removeListener('click');

                  //  Hide the login element
                  this.setVisible(false);

                  //  Populate the text with whatever they typed in
                  text.setText('Welcome ' + inputText.value);
              }
              else
              {
                  //  Flash the prompt
                  this.scene.tweens.add({
                      targets: text,
                      alpha: 0.2,
                      duration: 250,
                      ease: 'Power3',
                      yoyo: true
                  });
                          }
          }

      });

      this.tweens.add({
          targets: element,
          y: 300,
          duration: 3000,
          ease: 'Power3'
      });

      this.joyStick = this.plugins.get('rexvirtualjoystickplugin').add(this, {
                x: 150,
                y: 480,
                radius: 100,
                base: this.add.circle(0, 0, 100, 0x888888),
                thumb: this.add.circle(0, 0, 50, 0xcccccc)
            })
            .on('update', this.dumpJoyStickState, this);

        this.text = this.add.text(0, 0);
        this.dumpJoyStickState();

  }

  dumpJoyStickState() {
        var cursorKeys = this.joyStick.createCursorKeys();
        var s = 'Key down: ';
        for (var name in cursorKeys) {
            if (cursorKeys[name].isDown) {
                s += name + ' ';
            }
        }
        s += '\n';
        s += ('Force: ' + Math.floor(this.joyStick.force * 100) / 100 + '\n');
        s += ('Angle: ' + Math.floor(this.joyStick.angle * 100) / 100 + '\n');
        this.text.setText(s);
    }

    update() {}
}


var config = {
  type: Phaser.AUTO,
  scale: {
      parent: 'game-container',
      autoCenter: Phaser.Scale.CENTER_BOTH,
      mode: Phaser.Scale.FIT,
      width: 640,
      height: 640
  },
  dom: {
      createContainer: true
  },
  physics: {
      default: 'arcade',
      arcade: {
          gravity: { y: 200 }
      }
  },
  scene: Demo
};

var game = new Phaser.Game(config);
