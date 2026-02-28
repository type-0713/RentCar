import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./page/Home";
import NotFound from "./page/NotFound";

const App = () => {
  return (
    <div>
      <Routes>
        <Route path="/" element={<Navigate to="/dl-rent" replace />} />
        <Route path="/dl-rent" element={<Home/>}/>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

export default App;
