import { createRouter, createWebHistory } from "vue-router";
import CrisisDashboard from "../views/CrisisDashboard.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "crisis-dashboard",
      component: CrisisDashboard
    }
  ]
});

export default router;
