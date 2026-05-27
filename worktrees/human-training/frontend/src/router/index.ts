import { createRouter, createWebHistory } from "vue-router";
import AgoraVoice from "../views/AgoraVoice.vue";
import TrainingDemo from "../views/TrainingDemo.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "voice", component: AgoraVoice },
    { path: "/text", name: "text-demo", component: TrainingDemo }
  ]
});

export default router;
