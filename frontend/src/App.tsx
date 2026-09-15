import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Instructions } from './pages/Instructions';
import { Landing } from './pages/Landing';
import { Measure } from './pages/Measure';
import { Processing } from './pages/Processing';
import { Results } from './pages/Results';
import { ResultsDetails } from './pages/ResultsDetails';
import { MeasurementProvider } from './state/MeasurementContext';

export function App() {
  return (
    <MeasurementProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/instructions" element={<Instructions />} />
          <Route path="/measure" element={<Measure />} />
          <Route path="/processing" element={<Processing />} />
          <Route path="/results" element={<Results />} />
          <Route path="/results/details" element={<ResultsDetails />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MeasurementProvider>
  );
}

export default App;
