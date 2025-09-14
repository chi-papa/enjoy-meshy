// model-loader-component.js
// Three.jsとそのアドオンをインポート
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * WebGL 3Dモデルローダーカスタム要素
 *
 * 使用方法:
 * <webgl-model-loader
 *   model-url="path/to/model.glb"   // 3Dモデルのパス（必須）
 *   width="500px"                   // コンポーネントの幅（オプション、デフォルト：100%）
 *   height="300px"                  // コンポーネントの高さ（オプション、デフォルト：300px）
 *   background="transparent"        // 背景色（オプション、"transparent"または色コード、デフォルト：transparent）
 *   auto-rotate                     // 自動回転を有効にする（オプション、存在するだけで有効）
 *   rotate-speed="0.005"            // 回転速度（オプション、負の値で逆回転、デフォルト：0.005）
 *   scale="1.0"                     // モデルスケール（オプション、デフォルト：1.0）
 *   border-radius="12px"            // キャンバスの角丸設定（オプション、デフォルト：0px）
 * ></webgl-model-loader>
 *
 * HTML内での読み込み方法:
 * <script type="module" src="path/to/model-loader-component.js"></script>
 *
 * JavaScriptからの操作例:
 * const modelLoader = document.querySelector('webgl-model-loader');
 * modelLoader.setAttribute('rotate-speed', '-0.005'); // 逆回転に設定
 * modelLoader.setAttribute('border-radius', '20px');  // 角丸を変更
 * modelLoader.resetCamera();                          // カメラ位置をリセット
 */
class WebGLModelLoader extends HTMLElement {
  constructor() {
    super();

    // シャドウDOMの作成
    this.attachShadow({ mode: "open" });

    // シャドウDOMのスタイルとコンテナの初期化
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
        }
        .model-container {
          width: 100%;
          height: 100%;
          overflow: hidden;
          border-radius: 0px; /* カスタマイズ可能なコーナーの丸み */
        }
        canvas {
          border-radius: inherit; /* コンテナの丸みを継承 */
        }
      </style>
      <div class="model-container"></div>
    `;

    // プロパティの初期化
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.model = null;
    this.animationMixer = null;
    this.clock = new THREE.Clock();
    this.isAutoRotate = false;
    this.rotateSpeed = 0.005;
    this.isInitialized = false;
    this.borderRadius = "0px";

    // アニメーションループ関数をバインド
    this.animate = this.animate.bind(this);
  }

  // カスタム要素が接続されたときに呼び出される
  connectedCallback() {
    // コンテナ要素の取得
    this.container = this.shadowRoot.querySelector(".model-container");

    // 属性の読み取り
    this.width = this.getAttribute("width") || "100%";
    this.height = this.getAttribute("height") || "300px";
    this.modelUrl = this.getAttribute("model-url") || "";
    this.backgroundColor = this.getAttribute("background") || "transparent";
    this.isAutoRotate = this.hasAttribute("auto-rotate");
    this.rotateSpeed = parseFloat(this.getAttribute("rotate-speed") || "0.005");
    this.modelScale = parseFloat(this.getAttribute("scale") || "1.0");
    this.borderRadius = this.getAttribute("border-radius") || "0px";

    // コンテナのスタイル設定
    this.container.style.width = this.width;
    this.container.style.height = this.height;
    this.container.style.borderRadius = this.borderRadius;

    // WebGLシーンの初期化
    this.initScene();

    // モデルのロード
    if (this.modelUrl) {
      this.loadModel(this.modelUrl);
    }

    // リサイズイベントリスナーの追加
    window.addEventListener("resize", this.onWindowResize.bind(this));
  }

  // カスタム要素が切断されたときに呼び出される
  disconnectedCallback() {
    // リソースのクリーンアップ
    window.removeEventListener("resize", this.onWindowResize.bind(this));

    if (this.renderer) {
      this.renderer.dispose();
    }

    // シーンのクリーンアップ
    if (this.scene) {
      this.disposeScene(this.scene);
    }
  }

  // シーンのリソースを解放
  disposeScene(scene) {
    scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }

      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }

  // 属性が変更されたときに呼び出される
  attributeChangedCallback(name, oldValue, newValue) {
    if (!this.isInitialized) return;

    switch (name) {
      case "model-url":
        if (newValue !== oldValue && newValue) {
          this.loadModel(newValue);
        }
        break;
      case "background":
        if (this.scene) {
          if (newValue === "transparent" || newValue === "") {
            this.scene.background = null;
          } else {
            this.scene.background = new THREE.Color(newValue || "#000000");
          }
        }
        break;
      case "auto-rotate":
        this.isAutoRotate = this.hasAttribute("auto-rotate");
        break;
      case "rotate-speed":
        this.rotateSpeed = parseFloat(newValue || "0.005");
        break;
      case "scale":
        const scale = parseFloat(newValue || "1.0");
        if (this.model) {
          this.model.scale.set(scale, scale, scale);
        }
        break;
      case "border-radius":
        this.borderRadius = newValue || "0px";
        this.container.style.borderRadius = this.borderRadius;
        if (this.renderer && this.renderer.domElement) {
          this.renderer.domElement.style.borderRadius = this.borderRadius;
        }
        break;
    }
  }

  // 監視する属性のリスト
  static get observedAttributes() {
    return [
      "model-url",
      "background",
      "auto-rotate",
      "rotate-speed",
      "scale",
      "border-radius",
    ];
  }

  // WebGLシーンの初期化
  initScene() {
    // コンテナの幅と高さを取得
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // シーンの作成
    this.scene = new THREE.Scene();

    // 背景を透明に設定（または指定された背景色）
    if (this.backgroundColor === "transparent" || this.backgroundColor === "") {
      // 透明な背景の場合は、scene.backgroundをnullに設定
      this.scene.background = null;
    } else {
      this.scene.background = new THREE.Color(this.backgroundColor);
    }

    // カメラの作成
    this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    this.camera.position.set(20, 8, 5);

    // レンダラーの作成（透明背景対応）
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true, // 透明背景を有効化
      premultipliedAlpha: false, // 透明度の処理方法を調整
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x000000, 0); // 透明な背景を設定（第2引数の0が透明度）

    // レンダラーのDOMにスタイルを適用
    this.renderer.domElement.style.borderRadius = this.borderRadius;

    this.container.appendChild(this.renderer.domElement);

    // 環境光の追加
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    // 平行光源の追加
    const directionalLight = new THREE.DirectionalLight(0xffffff, 10);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    // OrbitControlsの設定
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableZoom = false; // スクロールによる拡大縮小を無効化

    // 初期状態フラグの設定
    this.isInitialized = true;

    // アニメーションループの開始
    this.animate();
  }

  // モデルのロード
  loadModel(url) {
    // ローダーの作成
    const loader = new GLTFLoader();

    // モデルを読み込む
    loader.load(
      url,
      (gltf) => {
        // 以前のモデルがあれば削除
        if (this.model) {
          this.scene.remove(this.model);
        }

        // モデルの取得
        this.model = gltf.scene;

        // モデルのスケール設定
        const scale = parseFloat(this.getAttribute("scale") || "900");
        this.model.scale.set(scale, scale, scale);

        // シーンにモデルを追加
        this.scene.add(this.model);

        // モデルの中心を計算
        const box = new THREE.Box3().setFromObject(this.model);
        const center = box.getCenter(new THREE.Vector3());

        // モデルを中心に配置
        this.model.position.sub(center);

        // カメラの位置を調整
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 240);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.2; // 余裕を持たせる

        this.camera.position.z = cameraZ;

        // コントロールのターゲットをリセット
        this.controls.target.set(0, -4, 0);
        this.controls.update();

        // アニメーションのセットアップ
        if (gltf.animations && gltf.animations.length > 0) {
          this.animationMixer = new THREE.AnimationMixer(this.model);
          const animation = gltf.animations[0];
          const action = this.animationMixer.clipAction(animation);
          action.play();
        }

        // モデルロード完了イベントの発火
        this.dispatchEvent(
          new CustomEvent("model-loaded", {
            bubbles: true,
            composed: true,
            detail: { model: this.model },
          })
        );
      },
      // 読み込み進捗イベント
      (xhr) => {
        const percentComplete = (xhr.loaded / xhr.total) * 100;
        console.log(`モデル読み込み進捗: ${Math.round(percentComplete)}%`);
      },
      // エラーイベント
      (error) => {
        console.error("モデルの読み込みに失敗しました:", error);

        // モデルロードエラーイベントの発火
        this.dispatchEvent(
          new CustomEvent("model-error", {
            bubbles: true,
            composed: true,
            detail: { error },
          })
        );
      }
    );
  }

  // アニメーションループ
  animate() {
    requestAnimationFrame(this.animate);

    // コントロールの更新
    if (this.controls) {
      this.controls.update();
    }

    // モデルの自動回転
    if (this.isAutoRotate && this.model) {
      this.model.rotation.y += this.rotateSpeed;
    }

    // アニメーションミキサーの更新
    if (this.animationMixer) {
      this.animationMixer.update(this.clock.getDelta());
    }

    // シーンのレンダリング
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ウィンドウリサイズ時の処理
  onWindowResize() {
    if (!this.camera || !this.renderer) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    // カメラのアスペクト比を更新
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // レンダラーのサイズを更新
    this.renderer.setSize(width, height);
  }

  // パブリックメソッド: カメラをリセット
  resetCamera() {
    if (!this.controls || !this.camera) return;

    // カメラ位置をリセット
    this.camera.position.set(0, 0, 5);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // モデルがある場合は、モデルに合わせてカメラを調整
    if (this.model) {
      const box = new THREE.Box3().setFromObject(this.model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = this.camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
      cameraZ *= 1.5; // 余裕を持たせる

      this.camera.position.z = cameraZ;
      this.controls.update();
    }
  }
}

// カスタム要素の登録
customElements.define("webgl-model-loader", WebGLModelLoader);
