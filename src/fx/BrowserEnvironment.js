Primrose.BrowserEnvironment = (function () {
  "use strict";

  if (typeof THREE === "undefined") {
    return function () {
    };
  }
  /*
   Create a new VR Application!
   
   `name` - name the application, for use with saving settings separately from
   other applications on the same domain
   `options` - optional values to override defaults
   | `avatarHeight` - the offset from the ground at which to place the camera
   | `walkSpeed` - how quickly the avatar moves across the ground
   | `button`
   | `model` - the model to use to make buttons, in THREE JSON format
   | `options` - configuration parameters for buttons
   | `maxThrow` - the distance the button may move
   | `minDeflection` - the angle boundary in which to do hit tests on the button
   | `colorUnpressed` - the color of the button when it is not depressed
   | `colorPressed` - the color of the button when it is depressed
   | `gravity` - the acceleration applied to falling objects (default: 9.8)
   | `useLeap` - use the Leap Motion device
   | `backgroundColor` - the color that WebGL clears the background with before drawing (default: 0x000000)
   | `drawDistance` - the far plane of the camera (default: 500)
   | `chatTextSize` - the size of a single line of text, in world units (default: 0.25)
   | `dtNetworkUpdate` - the amount of time to allow to elapse between sending state to teh server (default: 0.125)
   */
  var MILLISECONDS_TO_SECONDS = 0.001,
    RIGHT = new THREE.Vector3(1, 0, 0),
    UP = new THREE.Vector3(0, 1, 0),
    FORWARD = new THREE.Vector3(0, 0, -1),
    POINTER_RADIUS = 0.02,
    POINTER_RESCALE = 10,
    FORWARDED_EVENTS = [
      "keydown", "keyup", "keypress",
      "mousedown", "mouseup", "mousemove", "wheel",
      "touchstart", "touchend", "touchmove"];

  pliny.class({
    parent: "Primrose",
    name: "BrowserEnvironment",
    description: "Make a Virtual Reality app in your web browser!"
  });
  class BrowserEnvironment {
    constructor(name, options) {
      this.options = patch(options, BrowserEnvironment.DEFAULTS);

      var fire = emit.bind(this);

      this.addEventListener = (event, thunk, bubbles) => {
        if (this.listeners[event]) {
          this.listeners[event].push(thunk);
        }
        else if (FORWARDED_EVENTS.indexOf(event) >= 0) {
          window.addEventListener(event, thunk, bubbles);
        }
      };

      var lockedToEditor = () => {
        return this.currentControl && this.currentControl.lockMovement;
      };

      this.zero = () => {
        if (!lockedToEditor()) {
          this.player.position.set(0, this.avatarHeight, 0);
          this.player.velocity.set(0, 0, 0);
          this.input.zero();
          if (this.quality === Primrose.Quality.NONE) {
            this.quality = Primrose.Quality.HIGH;
          }
        }
      };


      var createPickableObject = (obj, includeGeometry) => {
        var geomObj = obj;
        if ((obj.type === "Object3D" || obj.type === "Group") && obj.children[0]) {
          geomObj = obj.children[0];
          geomObj.name = geomObj.name || obj.name;
        }
        var id = geomObj.uuid,
          mLeft = new THREE.Matrix4(),
          mRight = new THREE.Matrix4().identity(),
          mSwap,
          inScene = false,
          lastBag = objectHistory[id],
          update = false,
          disabled = !!obj.disabled,
          bag = {
            uuid: id,
            name: null,
            inScene: null,
            visible: null,
            disabled: null,
            matrix: null,
            geometry: null
          },
          head = geomObj;

        while (head !== null) {
          head.updateMatrix();
          mLeft.copy(head.matrix);
          mLeft.multiply(mRight);
          mSwap = mLeft;
          mLeft = mRight;
          mRight = mSwap;
          head = head.parent;
          inScene = inScene || (head === this.scene);
        }

        if (!lastBag || lastBag.visible !== obj.visible) {
          update = true;
          bag.visible = obj.visible;
        }

        if (!lastBag || lastBag.disabled !== disabled) {
          update = true;
          bag.disabled = disabled;
        }

        var m = mRight.elements.subarray(0, mRight.elements.length),
          mStr = describeMatrix(m);
        if (!lastBag || !lastBag.matrix || describeMatrix(lastBag.matrix) !== mStr) {
          update = true;
          bag.matrix = m;
        }

        if (!lastBag || lastBag.inScene !== inScene) {
          update = true;
          bag.inScene = inScene;
        }

        if (includeGeometry === true) {
          update = true;
          bag.name = obj.name;
          bag.geometry = geomObj.geometry;
        }

        if (update) {
          if (!lastBag) {
            objectHistory[id] = bag;
          }
          else {
            for (var key in bag) {
              lastBag[key] = bag[key];
            }
          }
          return bag;
        }
      };

      function describeMatrix(m) {
        var output = "";
        for (var i = 0; i < m.length; ++i) {
          if (i > 0) {
            output += ",";
          }
          output += m[i];
        }
        return output;
      }


      var objectHistory = {};

      this.registerPickableObject = (obj) => {
        if (obj) {
          var bag = createPickableObject(obj, true),
            verts, faces, uvs, i,
            geometry = bag.geometry;
          // it would be nice to do this the other way around, to have everything
          // stored in ArrayBuffers, instead of regular arrays, to pass to the
          // Worker thread. Maybe later.
          if (geometry instanceof THREE.BufferGeometry) {
            var attr = geometry.attributes,
              pos = attr.position,
              uv = attr.uv,
              idx = attr.index;

            verts = [];
            faces = [];
            if (uv) {
              uvs = [];
            }
            for (i = 0; i < pos.count; ++i) {
              verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
              if (uv) {
                uvs.push([uv.getX(i), uv.getY(i)]);
              }
            }
            if (idx) {
              for (i = 0; i < idx.count - 2; ++i) {
                faces.push([idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)]);
              }
            }
            else {
              for (i = 0; i < pos.count; i += 3) {
                faces.push([i, i + 1, i + 2]);
              }
            }
          }
          else {
            verts = geometry.vertices.map((v) => v.toArray());
            faces = [];
            uvs = [];
            // IDK why, but non-buffered geometry has an additional array layer
            for (i = 0; i < geometry.faces.length; ++i) {
              var f = geometry.faces[i],
                faceUVs = geometry.faceVertexUvs[0][i];
              faces.push([f.a, f.b, f.c]);
              uvs[f.a] = [faceUVs[0].x, faceUVs[0].y];
              uvs[f.b] = [faceUVs[1].x, faceUVs[1].y];
              uvs[f.c] = [faceUVs[2].x, faceUVs[2].y];
            }
          }

          bag.geometry = {
            uuid: geometry.uuid,
            vertices: verts,
            faces: faces,
            uvs: uvs
          };

          this.pickableObjects[bag.uuid] = obj;
          this.projector.setObject(bag);
        }
      };

      var update = (t) => {
        var dt = t - lt,
          i, j;
        lt = t;

        movePlayer(dt);
        moveSky();
        moveGround();
        movePointer();
        resolvePicking();
        checkQuality();
        fire("update", dt);
      };

      var movePlayer = (dt) => {

        this.input.update();
        var heading = this.input.getValue("heading"),
          pitch = this.input.getValue("pitch"),
          strafe = this.input.getValue("strafe"),
          drive = this.input.getValue("drive"),
          boost = this.input.getValue("boost");

        this.input.VR.getOrientation(qHead);

        qPitch.setFromAxisAngle(RIGHT, pitch);

        if (!lockedToEditor()) {
          if (this.player.velocity.y === 0 && boost > 0) {
            this.player.isOnGround = false;
          }

          this.player.velocity.y += boost;
        }

        if (!this.player.isOnGround) {
          this.player.velocity.y -= this.options.gravity * dt;
        }
        else if (!lockedToEditor()) {
          this.player.velocity.set(strafe, 0, drive)
            .normalize()
            .multiplyScalar(this.walkSpeed);

          qHeading.setFromAxisAngle(UP, currentHeading);
          this.player.velocity.applyQuaternion(qHead);
          this.player.velocity.y = 0;
          this.player.velocity.applyQuaternion(qHeading);
        }
        this.player.position.add(vBody.copy(this.player.velocity).multiplyScalar(dt));

        if (!this.player.isOnGround && this.player.position.y < this.avatarHeight) {
          this.player.isOnGround = true;
          this.player.position.y = this.avatarHeight;
          this.player.velocity.y = 0;
        }

        if (this.inVR) {
          var dHeading = heading - currentHeading;
          if (!lockedToEditor() && Math.abs(dHeading) > Math.PI / 5) {
            var dh = Math.sign(dHeading) * Math.PI / 100;
            currentHeading += dh;
            heading -= dh;
            dHeading = heading - currentHeading;
          }
          this.player.quaternion.setFromAxisAngle(UP, currentHeading);
          qHeading.setFromAxisAngle(UP, dHeading).multiply(qPitch);
        }
        else {
          currentHeading = heading;
          this.player.quaternion.setFromAxisAngle(UP, currentHeading);
          this.player.quaternion.multiply(qPitch);
        }
      };

      var moveSky = () => {
        if (this.sky) {
          this.sky.position.copy(this.player.position);
        }
      };

      var moveGround = () => {
        if (this.ground) {
          this.ground.position.set(
            Math.floor(this.player.position.x),
            0,
            Math.floor(this.player.position.z));
          this.ground.material.needsUpdate = true;
        }
      };

      var movePointer = () => {
        this.pointer.position.copy(FORWARD);
        if (this.inVR && !isMobile) {
          this.pointer.position.applyQuaternion(qHeading);
        }
        if (!lockedToEditor() || isMobile) {
          this.pointer.position.add(this.camera.position);
          this.pointer.position.applyQuaternion(this.camera.quaternion);
        }
        this.pointer.position.applyQuaternion(this.player.quaternion);
        this.pointer.position.add(this.player.position);
      };

      var pointerStart = (name) => {
        if (!(name === "keyboard" && lockedToEditor())) {
          if (currentHit) {
            var object = this.pickableObjects[currentHit.objectID];
            if (object) {
              var control = object.button || object.surface;
              fire("pointerstart", currentHit);
              emit.call(object, "click");

              if (this.currentControl && this.currentControl !== control) {
                this.currentControl.blur();
                this.currentControl = null;
              }

              if (!this.currentControl && control) {
                this.currentControl = control;
                this.currentControl.focus();
              }
              else if (object === this.ground) {
                this.player.position.copy(this.pointer.position);
                this.player.position.y = this.avatarHeight;
                this.player.isOnGround = false;
              }

              if (this.currentControl) {
                this.currentControl.startUV(currentHit.point);
              }
            }
          }
          else if (this.currentControl) {
            this.currentControl.blur();
            this.currentControl = null;
          }
        }
      };

      var pointerEnd = (name) => {
        if (!(name === "keyboard" && lockedToEditor()) && currentHit) {
          var object = this.pickableObjects[currentHit.objectID];
          if (object) {
            var control = object.button || object.surface;
            fire("pointerend", lastHit);

            if (this.currentControl) {
              this.currentControl.endPointer();
            }
          }
        }
      };

      var resolvePicking = () => {

        if (this.projector.ready) {
          this.projector.ready = false;
          var arr = [],
            del = [];
          for (var key in this.pickableObjects) {
            var obj = this.pickableObjects[key],
              p = createPickableObject(obj);
            if (p) {
              arr.push(p);
              if (p.inScene === false) {
                del.push(key);
              }
            }
          }

          if (arr.length > 0) {
            this.projector.updateObjects(arr);
          }
          for (var i = 0; i < del.length; ++i) {
            delete this.pickableObjects[del[i]];
          }

          this.projector.projectPointer([
            this.pointer.position.toArray(),
            transformForPicking(this.player)]);
        }

        var lastButtons = this.input.getValue("dButtons");
        if (currentHit) {
          var fp = currentHit.facePoint,
            fn = currentHit.faceNormal,
            object = this.pickableObjects[currentHit.objectID];
          this.pointer.position.set(
            fp[0] + fn[0] * POINTER_RADIUS,
            fp[1] + fn[1] * POINTER_RADIUS,
            fp[2] + fn[2] * POINTER_RADIUS);

          if (object === this.ground) {
            this.pointer.scale.set(POINTER_RESCALE * 0.5, POINTER_RESCALE, POINTER_RESCALE * 0.5);
          }
          else {
            this.pointer.scale.set(0.5, 1, 0.5);
          }

          this.pointer.material.color.setRGB(0, 1, 0);
          this.pointer.material.emissive.setRGB(0.25, 0.25, 0.25);

          if (object) {
            var buttons = this.input.getValue("buttons"),
              clickChanged = lastButtons !== 0,
              control = object.button || object.surface;

            if (!lockedToEditor()) {
              buttons |= this.input.Keyboard.getValue("select");
              clickChanged = clickChanged || this.input.Keyboard.getValue("dSelect") !== 0;
            }

            if (!clickChanged && buttons > 0) {
              if (lastHit && currentHit && lastHit.objectID === currentHit.objectID) {
                fire("pointermove", currentHit);
              }
              if (this.currentControl && currentHit.point) {
                this.currentControl.moveUV(currentHit.point);
              }
            }
          }
        }
        else {
          this.pointer.material.color.setRGB(1, 0, 0);
          this.pointer.material.emissive.setRGB(0.25, 0, 0);
          this.pointer.scale.set(1, 1, 1);
        }
      };

      var animate = (t) => {
        WebVRBootstrapper.dispalyPresentChangeCheck();
        RAF(animate);
        update(t * MILLISECONDS_TO_SECONDS);
        render();
      };


      var eyeCounter = 0, blankEye = false;
      var render = () => {
        if (this.inVR && this.input.VR.currentPose) {
          this.renderer.clear(true, true, true);
          var trans = this.input.VR.transforms;
          for (var i = 0; trans && i < trans.length; ++i) {
            var st = trans[i],
              v = st.viewport,
              side = (2 * i) - 1;
            Primrose.Entity.eyeBlankAll(i);
            this.input.getVector3("headX", "headY", "headZ", this.camera.position);
            this.camera.projectionMatrix.copy(st.projection);
            vEye.set(0, 0, 0);
            vEye.applyMatrix4(st.translation);
            vEye.applyQuaternion(qHead);
            this.camera.position.add(vEye);
            this.camera.quaternion.copy(qHead);
            if (this.options.useNose) {
              this.nose.visible = true;
              this.nose.position.set(side * -0.12, -0.12, -0.15);
              this.nose.rotation.z = side * 0.7;
            }
            this.renderer.setViewport(
              v.left * resolutionScale,
              v.top * resolutionScale,
              v.width * resolutionScale,
              v.height * resolutionScale);
            this.renderer.render(this.scene, this.camera);
          }
          this.input.VR.currentDisplay.submitFrame(this.input.VR.currentPose);
        }

        if (!isMobile) {
          this.audio.setPlayer(this.camera);
        }

        if (!this.inVR || (this.input.VR.currentDisplay.capabilities.hasExternalDisplay && !this.options.disableMirroring)) {
          if (blankEye) {
            eyeCounter = 1 - eyeCounter;
            Primrose.Entity.eyeBlankAll(eyeCounter);
          }
          this.nose.visible = false;
          this.camera.fov = this.options.defaultFOV;
          this.camera.aspect = this.renderer.domElement.width / this.renderer.domElement.height;
          this.camera.updateProjectionMatrix();
          this.camera.position.set(0, 0, 0);
          this.camera.quaternion.copy(qHead);
          this.renderer.clear(true, true, true);
          this.renderer.setViewport(0, 0, this.renderer.domElement.width, this.renderer.domElement.height);
          this.renderer.render(this.scene, this.camera);
        }
      };

      var setOrientationLock = () => {
        if (isFullScreenMode()) {
          var type = screen.orientation && screen.orientation.type || screen.mozOrientation || "";
          if (type.indexOf("landscape") === -1) {
            type = "landscape-primary";
          }
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock(type);
          }
          else if (screen.mozLockOrientation) {
            screen.mozLockOrientation(type);
          }
        }
        else {
          if (screen.orientation && screen.orientation.unlock) {
            screen.orientation.unlock();
          }
          else if (screen.mozUnlockOrientation) {
            screen.mozUnlockOrientation();
          }
        }
      };

      var modifyScreen = () => {
        this.input.VR.resetTransforms(
          this.options.nearPlane,
          this.options.nearPlane + this.options.drawDistance);

        var p = this.input.VR.transforms,
          canvasWidth = 0,
          canvasHeight = 0;

        for (var i = 0; i < p.length; ++i) {
          canvasWidth += p[i].viewport.width;
          canvasHeight = Math.max(canvasHeight, p[i].viewport.height);
        }
        canvasWidth = Math.floor(canvasWidth * resolutionScale);
        canvasHeight = Math.floor(canvasHeight * resolutionScale);

        this.renderer.domElement.width = canvasWidth;
        this.renderer.domElement.height = canvasHeight;
        if (!this.timer) {
          render();
        }
      };

      //
      // Initialize local variables
      //
      var lt = 0,
        lastHit = null,
        currentHit = null,
        currentHeading = 0,
        qPitch = new THREE.Quaternion(),
        qHeading = new THREE.Quaternion(),
        qHead = new THREE.Quaternion(),
        vEye = new THREE.Vector3(),
        vBody = new THREE.Vector3(),
        skin = Primrose.Random.item(Primrose.SKIN_VALUES),
        readyFired = false,
        modelFiles = {
          monitor: this.options.fullScreenIcon,
          cardboard: this.options.VRIcon,
          scene: this.options.sceneModel,
          button: this.options.button && typeof this.options.button.model === "string" && this.options.button.model,
          font: this.options.font
        },
        fgColor = null,
        icons = null,
        iconModels = {
          "Standard Monitor": null,
        },
        resolutionScale = 1,
        factories = {
          button: Primrose.Controls.Button2D,
          img: Primrose.Controls.Image,
          div: Primrose.Controls.HtmlDoc,
          section: Primrose.Surface,
          textarea: Primrose.Text.Controls.TextBox,
          pre: {
            create: () => new Primrose.Text.Controls.TextBox({
              tokenizer: Primrose.Text.Grammars.PlainText,
              hideLineNumbers: true,
              readOnly: true
            })
          }
        };


      this.createElement = (type) => {
        if (factories[type]) {
          return factories[type].create();
        }
      };

      this.appendChild = (elem) => {
        if (elem instanceof THREE.Mesh) {
          this.scene.add(elem);
          this.registerPickableObject(elem);
        }
        else {
          return elem.addToBrowserEnvironment(this, this.scene);
        }
      };

      function setColor(model, color) {
        return model.children[0].material.color.set(color);
      }

      function complementColor(color) {
        var rgb = color.clone();
        var hsl = rgb.getHSL();
        hsl.h = hsl.h + 0.5;
        hsl.l = 1 - hsl.l;
        while (hsl.h > 1) hsl.h -= 1;
        rgb.setHSL(hsl.h, hsl.s, hsl.l);
        return rgb;
      }

      var putIconInScene = (icon, i, arr) => {
        var arm = hub();
        arm.add(icon);
        icon.position.z = -1;
        put(arm)
          .on(this.scene)
          .at(0, this.options.avatarHeight, 0);
        var wedge = 75 / arr.length;
        arm.rotation.set(0, Math.PI * wedge * ((arr.length - 1) * 0.5 - i) / 180, 0);
        this.registerPickableObject(icon);
      };

      var makeIcon = (display, i) => {
        var isVR = !(display instanceof StandardMonitorPolyfill),
          icon = (iconModels[display.displayName] || iconModels["Google Cardboard"]).clone(),
          geom = icon.children[0] && icon.children[0].geometry || icon.geometry,
          titleText = textured(text3D(0.05, display.displayName), fgColor),
          funcText = textured(text3D(0.05, isVR ? "VR" : "Fullscreen"), fgColor);

        icon.name = (display.displayName + "Icon").replace(/ /g, "");
        icon.addEventListener("click", this.goFullScreen.bind(this, i), false);

        geom.computeBoundingBox();

        put(funcText)
          .on(icon)
          .rot(0, 90 * Math.PI / 180, 0)
          .at(0, geom.boundingBox.max.y + 0.01, funcText.geometry.boundingSphere.radius);


        put(titleText)
          .on(icon)
          .rot(0, 90 * Math.PI / 180, 0)
          .at(0, geom.boundingBox.min.y - titleText.geometry.boundingBox.max.y - 0.01, titleText.geometry.boundingSphere.radius);

        put(icon)
          .on(this.scene)
          .rot(0, 270 * Math.PI / 180, 0);

        this.registerPickableObject(icon);
        return icon;
      };

      var modelsReady = Primrose.ModelLoader.loadObjects(modelFiles)
        .then((models) => {
          window.text3D = function (font, size, text) {
            var geom = new THREE.TextGeometry(text, {
              font: font,
              size: size,
              height: size / 5,
              curveSegments: 2
            });
            geom.computeBoundingSphere();
            geom.computeBoundingBox();
            return geom;
          }.bind(window, models.font);

          if (models.scene) {
            buildScene(models.scene);
          }

          fgColor = complementColor(new THREE.Color(this.options.backgroundColor)).getHex();

          if (models.monitor) {
            iconModels["Standard Monitor"] = new Primrose.ModelLoader(models.monitor);
          }

          if (models.cardboard) {
            iconModels["Google Cardboard"] = new Primrose.ModelLoader(models.cardboard);
          }
          else {
            iconModels["Google Cardboard"] = brick(0xffffff, 0.1, 0.1, 0.1);
          }

          iconModels["Test Icon"] =
            iconModels["Oculus Rift DK2, Oculus VR"] =
            iconModels["Device Motion API"] =
            iconModels["Google, Inc. Cardboard v1"] = iconModels["Google Cardboard"];

          icons = (this.input.VR && this.input.VR.displays || [{ displayName: "Test Icon" }])
            .map(makeIcon);

          icons.forEach(putIconInScene);

          if (models.button) {
            this.buttonFactory = new Primrose.ButtonFactory(
              models.button,
              this.options.button.options);
          }
          else {
            this.buttonFactory = new Primrose.ButtonFactory(
              brick(0xff0000, 1, 1, 1), {
                maxThrow: 0.1,
                minDeflection: 10,
                colorUnpressed: 0x7f0000,
                colorPressed: 0x007f00,
                toggle: true
              });
          }
        })
        .catch((err) => {
          console.error(err);
          if (!this.buttonFactory) {
            this.buttonFactory = new Primrose.ButtonFactory(
              brick(0xff0000, 1, 1, 1), {
                maxThrow: 0.1,
                minDeflection: 10,
                colorUnpressed: 0x7f0000,
                colorPressed: 0x007f00,
                toggle: true
              });
          }
        });

      //
      // Initialize public properties
      //
      this.currentControl = null;
      this.avatarHeight = this.options.avatarHeight;
      this.walkSpeed = this.options.walkSpeed;
      this.listeners = {
        ready: [],
        update: [],
        gazestart: [],
        gazecomplete: [],
        gazecancel: [],
        pointerstart: [],
        pointermove: [],
        pointerend: []
      };

      this.audio = new Primrose.Output.Audio3D();
      var audioReady = null,
        ocean = null;
      if (this.options.ambientSound && !isMobile) {
        audioReady = this.audio.load3DSound(this.options.ambientSound, true, -1, 1, -1)
          .then((aud) => {
            ocean = aud;
            if (!(ocean.source instanceof MediaElementAudioSourceNode)) {
              ocean.volume.gain.value = 0.1;
              console.log(ocean.source);
              ocean.source.start();
            }
          }).catch(console.error.bind(console, "Audio3D loadSource"));
      }
      else {
        audioReady = Promise.resolve();
      }


      var documentReady = null;
      if (document.readyState === "complete") {
        documentReady = Promise.resolve();
      }
      else {
        documentReady = new Promise((resolve, reject) => {
          document.addEventListener("readystatechange", (evt) => {
            if (document.readyState === "complete") {
              resolve();
            }
          }, false);
        });
      }

      var allReady = Promise.all([modelsReady, audioReady, documentReady]);
      this.music = new Primrose.Output.Music(this.audio.context);

      this.pickableObjects = {};

      this.projector = new Primrose.Workerize(Primrose.Projector);

      this.player = new THREE.Object3D();
      this.player.velocity = new THREE.Vector3();
      this.player.name = "Player";
      this.player.position.set(0, this.avatarHeight, 0);
      this.player.isOnGround = true;

      this.pointer = textured(sphere(POINTER_RADIUS, 10, 10), 0xff0000, {
        emissive: 0x3f0000,
        opacity: 0.75
      });

      this.nose = textured(sphere(0.05, 10, 10), skin);
      this.nose.name = "Nose";
      this.nose.scale.set(0.5, 1, 1);

      this.scene = this.options.scene || new THREE.Scene();
      if (this.options.useFog) {
        this.scene.fog = new THREE.FogExp2(this.options.backgroundColor, 2 / this.options.drawDistance);
      }

      this.camera = new THREE.PerspectiveCamera(75, 1, this.options.nearPlane, this.options.nearPlane + this.options.drawDistance);
      if (this.options.skyTexture) {
        this.sky = textured(
          shell(
            this.options.drawDistance,
            18,
            9,
            Math.PI * 2,
            Math.PI),
          this.options.skyTexture,
          { unshaded: true });
        this.sky.name = "Sky";
        this.scene.add(this.sky);
      }

      if (this.options.groundTexture) {
        var dim = 10,
          gm = new THREE.PlaneGeometry(dim * 5, dim * 5, dim, dim);
        this.ground = textured(gm, this.options.groundTexture, {
          txtRepeatS: dim * 5,
          txtRepeatT: dim * 5
        });
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.name = "Ground";
        this.scene.add(this.ground);
        this.registerPickableObject(this.ground);
      }

      this.camera.add(this.nose);
      this.player.add(this.camera);
      this.scene.add(this.player);
      this.scene.add(this.pointer);

      if (this.passthrough) {
        this.camera.add(this.passthrough.mesh);
      }

      var buildScene = (sceneGraph) => {
        sceneGraph.buttons = [];
        sceneGraph.traverse(function (child) {
          if (child.isButton) {
            sceneGraph.buttons.push(
              new Primrose.Controls.Button3D(child.parent, child.name));
          }
          if (child.name) {
            sceneGraph[child.name] = child;
          }
        });
        this.scene.add.apply(this.scene, sceneGraph.children);
        this.scene.traverse((obj) => {
          if (obj.name) {
            this.scene[obj.name] = obj;
          }
        });
        if (sceneGraph.Camera) {
          this.camera.position.copy(sceneGraph.Camera.position);
          this.camera.quaternion.copy(sceneGraph.Camera.quaternion);
        }
        return sceneGraph;
      };

      put(light(0xffffff, 1.5, 50))
        .on(this.scene)
        .at(0, 10, 10);

      var RAF = (callback) => {
        this.timer = this.input.VR.currentDisplay.requestAnimationFrame(callback);
      };

      this.start = () => {
        allReady
          .then(() => {
            this.audio.start();
            lt = performance.now() * MILLISECONDS_TO_SECONDS;
            RAF(animate);
          });
      };

      this.stop = () => {
        this.input.VR.currentDisplay.cancelAnimationFrame(this.timer);
        this.audio.stop();
        this.timer = null;
      };

      var handleHit = (h) => {
        var dt;
        this.projector.ready = true;
        lastHit = currentHit;
        currentHit = h;
        if (lastHit && currentHit && lastHit.objectID === currentHit.objectID) {
          currentHit.startTime = lastHit.startTime;
          currentHit.gazeFired = lastHit.gazeFired;
          dt = lt - currentHit.startTime;
          if (dt >= this.options.gazeLength && !currentHit.gazeFired) {
            currentHit.gazeFired = true;
            fire("gazecomplete", currentHit);
          }
        }
        else {
          if (lastHit) {
            dt = lt - lastHit.startTime;
            if (dt < this.options.gazeLength) {
              fire("gazecancel", lastHit);
            }
          }
          if (currentHit) {
            currentHit.startTime = lt;
            currentHit.gazeFired = false;
            fire("gazestart", currentHit);
          }
        }
      };

      var keyDown = (evt) => {
        if (!lockedToEditor() && !evt.shiftKey && !evt.ctrlKey && !evt.altKey && !evt.metaKey) {
          if (evt.keyCode === Primrose.Keys.E) {
            blankEye = true;
            evt.preventDefault();
          }
        }
        else if (this.currentControl) {
          var elem = this.currentControl.focusedElement;
          if (elem) {
            if (elem.execCommand) {
              var oldDeadKeyState = this.operatingSystem._deadKeyState;
              if (elem.execCommand(this._browser, this.codePage, this.operatingSystem.makeCommandName(evt, this.codePage))) {
                evt.preventDefault();
              }
              if (this.operatingSystem._deadKeyState === oldDeadKeyState) {
                this.operatingSystem._deadKeyState = "";
              }
            }
            else {
              elem.keyDown(evt);
            }
          }
        }
      };

      var keyUp = (evt) => {
        if (this.currentControl && this.currentControl.keyUp) {
          this.currentControl.keyUp(evt);
        }
        else if (!evt.shiftKey && !evt.ctrlKey && !evt.altKey && !evt.metaKey) {
          if (evt.keyCode === Primrose.Keys.E) {
            blankEye = false;
          }
        }
      };

      //
      // Manage full-screen state
      //
      this.goFullScreen = (index) => {
        setPointerLock();
        this.input.VR.connect(index);
        return this.input.VR.requestPresent([{ source: this.renderer.domElement }])
          .then((elem) => {
            if (Primrose.Input.VR.Version === 1 && isMobile) {
              var remover = () => {
                this.input.VR.currentDisplay.exitPresent();
                window.removeEventListener("vrdisplaypresentchange", remover);
              };

              var adder = () => {
                window.addEventListener("vrdisplaypresentchange", remover, false);
                window.removeEventListener("vrdisplaypresentchange", adder);
              };

              window.addEventListener("vrdisplaypresentchange", adder, false);
            }

            return elem;
          });
      };


      var showHideButtons = () => {
        console.log(isFullScreenMode());
        icons.forEach((icon) => {
          icon.visible = !isFullScreenMode();
          icon.disabled = isFullScreenMode();
        });
      };

      if (isMobile) {
        if (WebVRBootstrapper.Version >= 1) {
          window.addEventListener("vrdisplaypresentchange", (evt) => {
            if (window.VRDisplay && this.input.VR.currentDisplay instanceof VRDisplay) {
              setOrientationLock();
              showHideButtons();
            }
          }, false);
        }
        FullScreen.addChangeListener((evt) => {
          if (!window.VRDisplay || !(this.input.VR.currentDisplay instanceof VRDisplay)) {
            setOrientationLock();
            showHideButtons();
          }
        }, false);
      }
      else {
        window.addEventListener("vrdisplaypresentchange", showHideButtons, false);
      }

      Primrose.Input.Mouse.Lock.addChangeListener((evt) => {
        if (!Primrose.Input.Mouse.Lock.isActive) {
          this.input.VR.currentDisplay.exitPresent();
        }
      }, false);

      window.addEventListener("vrdisplaypresentchange", modifyScreen, false);
      FullScreen.addChangeListener(modifyScreen, false);

      var isFullScreenMode = () => FullScreen.isActive || this.input.VR.currentDisplay.isPresenting;

      BrowserEnvironment.createSurrogate.call(this);

      this.operatingSystem = this.options.os;
      this.codePage = this.options.language;


      var focusClipboard = (evt) => {
        var cmdName = this.operatingSystem.makeCommandName(evt, this.codePage);
        if (cmdName === "CUT" || cmdName === "COPY") {
          this._surrogate.style.display = "block";
          this._surrogate.focus();
        }
      };

      var setPointerLock = () => {
        return ((Primrose.Input.Mouse.Lock.isActive || isMobile)
          ? Promise.resolve()
          : Primrose.Input.Mouse.Lock.request(this.renderer.domElement))
          .then(setFullscreen);
      };

      var setFullscreen = () => {
        if (!isFullScreenMode() && isMobile) {
          this.goFullScreen(1);
        }
      };

      var withCurrentControl = (name) => {
        return (evt) => {
          if (this.currentControl) {
            if (this.currentControl[name]) {
              this.currentControl[name](evt);
            }
            else {
              console.warn("Couldn't find %s on %o", name, this.currentControl);
            }
          }
        };
      };

      this._browser = isChrome ? "CHROMIUM" : (isFirefox ? "FIREFOX" : (isIE ? "IE" : (isOpera ? "OPERA" : (isSafari ? "SAFARI" : "UNKNOWN"))));
      window.addEventListener("keydown", keyDown, false);
      window.addEventListener("keyup", keyUp, false);
      window.addEventListener("keydown", focusClipboard, true);
      window.addEventListener("beforepaste", setFalse, false);
      window.addEventListener("paste", withCurrentControl("readClipboard"), false);
      window.addEventListener("wheel", withCurrentControl("readWheel"), false);
      window.addEventListener("resize", modifyScreen, false);
      window.addEventListener("blur", this.stop, false);
      window.addEventListener("focus", this.start, false);

      this.projector.addEventListener("hit", handleHit, false);

      documentReady.then(() => {
        if (this.options.renderer) {
          this.renderer = this.options.renderer;
        }
        else {
          this.renderer = new THREE.WebGLRenderer({
            canvas: Primrose.DOM.cascadeElement(this.options.canvasElement, "canvas", HTMLCanvasElement),
            context: this.options.context,
            antialias: !isMobile,
            alpha: true,
            logarithmicDepthBuffer: false
          });
          this.renderer.autoClear = false;
          this.renderer.autoSortObjects = true;
          this.renderer.setClearColor(this.options.backgroundColor);
          if (!this.renderer.domElement.parentElement) {
            document.body.appendChild(this.renderer.domElement);
          }
        }

        this.renderer.domElement.addEventListener('webglcontextlost', this.stop, false);
        this.renderer.domElement.addEventListener('webglcontextrestored', this.start, false);


        this.input = new Primrose.Input.FPSInput(this.renderer.domElement);
        this.input.addEventListener("zero", this.zero, false);
        this.input.addEventListener("lockpointer", setPointerLock, false);
        this.input.addEventListener("pointerstart", pointerStart, false);
        this.input.addEventListener("pointerend", pointerEnd, false);

        this.renderer.domElement.style.cursor = "default";
        this.input.VR.init().then(() => {
          this.input.VR.connect(0);
          fire("ready");
        });
      });


      var quality = -1,
        frameCount = 0, frameTime = 0,
        NUM_FRAMES = 10,
        LEAD_TIME = 2000,
        lastQualityChange = 0,
        dq1 = 0,
        dq2 = 0;

      var checkQuality = () => {
        if (this.options.autoScaleQuality &&
          // don't check quality if we've already hit the bottom of the barrel.
          this.quality !== Primrose.Quality.NONE) {
          if (frameTime < lastQualityChange + LEAD_TIME) {
            // wait a few seconds before testing quality
            frameTime = performance.now();
          }
          else {
            ++frameCount;
            if (frameCount === NUM_FRAMES) {
              var now = performance.now(),
                dt = (now - frameTime) * 0.001,
                fps = Math.round(NUM_FRAMES / dt);
              frameTime = now;
              frameCount = 0;
              // save the last change
              dq2 = dq1;

              // if we drop low, decrease quality
              if (fps < 45) {
                dq1 = -1;
              }
              else if (
                // don't upgrade on mobile devices
                !isMobile &&
                // don't upgrade if the user says not to
                this.options.autoRescaleQuality &&
                //good speed
                fps >= 60 &&
                // still room to grow
                this.quality < Primrose.Quality.MAXIMUM &&
                // and the last change wasn't a downgrade
                dq2 !== -1) {
                dq1 = 1;
              }
              else {
                dq1 = 0;
              }
              if (dq1 !== 0) {
                this.quality += dq1;
              }
              lastQualityChange = now;
            }
          }
        }
      };

      Object.defineProperties(this, {
        hasOrientation: {
          get: () => this.input.VR.currentDisplay.hasOrientation
        },
        inVR: {
          get: () => this.input.VR.transforms.length > 1
        },
        displays: {
          get: () => this.input.VR.displays || []
        },
        quality: {
          get: () => quality,
          set: (v) => {
            if (0 <= v && v < Primrose.RESOLUTION_SCALES.length) {
              quality = v;
              resolutionScale = Primrose.RESOLUTION_SCALES[v];
            }
            allReady.then(modifyScreen);
          }
        }
      });

      this.quality = this.options.quality;

      if (window.alert.toString().indexOf("native code") > -1) {
        // overwrite the native alert functions so they can't be called while in
        // fullscreen VR mode.

        var rerouteDialog = (oldFunction, newFunction) => {
          if (!newFunction) {
            newFunction = function () {
            };
          }
          return function () {
            if (isFullScreenMode()) {
              newFunction();
            }
            else {
              oldFunction.apply(window, arguments);
            }
          };
        };

        window.alert = rerouteDialog(window.alert);
        window.confirm = rerouteDialog(window.confirm);
        window.prompt = rerouteDialog(window.prompt);
      }

      this.start();
    }

    get operatingSystem() {
      return this._operatingSystem;
    }

    set operatingSystem(os) {
      this._operatingSystem = os || (isOSX ? Primrose.Text.OperatingSystems.OSX : Primrose.Text.OperatingSystems.Windows);
    }

    get codePage() {
      return this._codePage;
    }

    set codePage(cp) {
      var key,
        code,
        char,
        name;
      this._codePage = cp;
      if (!this._codePage) {
        var lang = (navigator.languages && navigator.languages[0]) ||
          navigator.language ||
          navigator.userLanguage ||
          navigator.browserLanguage;

        if (!lang || lang === "en") {
          lang = "en-US";
        }

        for (key in Primrose.Text.CodePages) {
          cp = Primrose.Text.CodePages[key];
          if (cp.language === lang) {
            this._codePage = cp;
            break;
          }
        }

        if (!this._codePage) {
          this._codePage = Primrose.Text.CodePages.EN_US;
        }
      }
    }

    static createSurrogate() {

      var clipboardOperation = (name, evt) => {
        if (this.currentControl) {
          this.currentControl[name + "SelectedText"](evt);
          if (!evt.returnValue) {
            evt.preventDefault();
          }
          this._surrogate.style.display = "none";
          this.currentControl.canvas.focus();
        }
      };

      // the `surrogate` textarea makes clipboard events possible
      this._surrogate = Primrose.DOM.cascadeElement("primrose-surrogate-textarea", "textarea", HTMLTextAreaElement);
      this._surrogateContainer = Primrose.DOM.makeHidingContainer("primrose-surrogate-textarea-container", this._surrogate);
      this._surrogateContainer.style.position = "absolute";
      this._surrogateContainer.style.overflow = "hidden";
      this._surrogateContainer.style.width = 0;
      this._surrogateContainer.style.height = 0;
      this._surrogate.addEventListener("beforecopy", setFalse, false);
      this._surrogate.addEventListener("copy", clipboardOperation.bind(this, "copy"), false);
      this._surrogate.addEventListener("beforecut", setFalse, false);
      this._surrogate.addEventListener("cut", clipboardOperation.bind(this, "cut"), false);
      document.body.insertBefore(this._surrogateContainer, document.body.children[0]);
    }
  }

  BrowserEnvironment.DEFAULT_USER_NAME = "CURRENT_USER_OFFLINE";

  BrowserEnvironment.DEFAULTS = {
    autoScaleQuality: true,
    autoRescaleQuality: false,
    quality: Primrose.Quality.MAXIMUM,
    useNose: false,
    useLeap: false,
    useFog: false,
    avatarHeight: 1.75,
    walkSpeed: 2,
    // The acceleration applied to falling objects.
    gravity: 9.8,
    // The amount of time in seconds to require gazes on objects before triggering the gaze event.
    gazeLength: 1,
    // By default, what we see in the VR view will get mirrored to a regular view on the primary screen. Set to true to improve performance.
    disableMirroring: false,
    // The color that WebGL clears the background with before drawing.
    backgroundColor: 0xafbfff,
    // the near plane of the camera.
    nearPlane: 0.01,
    // the far plane of the camera.
    drawDistance: 100,
    // the field of view to use in non-VR settings.
    defaultFOV: 75,
    // the amount of time to allow to elapse between sending state to the server.
    dtNetworkUpdate: 0.125,
    // The sound to play on loop in the background.
    ambientSound: null,
    // HTML5 canvas element, if one had already been created.
    canvasElement: "frontBuffer",
    // THREE.js renderer, if one had already been created.
    renderer: null,
    // A WebGL context to use, if one had already been created.
    context: null,
    // THREE.js scene, if one had already been created.
    scene: null
  };

  function transformForPicking(obj) {
    var p = obj.position.clone();
    obj = obj.parent;
    while (obj !== null) {
      p.applyMatrix4(obj.matrix);
      obj = obj.parent;
    }
    return p.toArray();
  }

  return BrowserEnvironment;
})();

