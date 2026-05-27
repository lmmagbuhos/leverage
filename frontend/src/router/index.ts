import { createRouter, createWebHistory } from "vue-router";
import CrisisDashboard from "../views/CrisisDashboard.vue";
import AgentBenchmark from "../views/AgentBenchmark.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "crisis-dashboard",
      component: CrisisDashboard,
    },
    {
      path: "/benchmark",
      name: "agent-benchmark",
      component: AgentBenchmark,
    },
  ],
});

export default router;
