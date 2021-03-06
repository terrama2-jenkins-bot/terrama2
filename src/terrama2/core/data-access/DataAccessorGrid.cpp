/*
 Copyright (C) 2007 National Institute For Space Research (INPE) - Brazil.

 This file is part of TerraMA2 - a free and open source computational
 platform for analysis, monitoring, and alert of geo-environmental extremes.

 TerraMA2 is free software: you can redistribute it and/or modify
 it under the terms of the GNU Lesser General Public License as published by
 the Free Software Foundation, either version 3 of the License,
 or (at your option) any later version.

 TerraMA2 is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 GNU Lesser General Public License for more details.

 You should have received a copy of the GNU Lesser General Public License
 along with TerraMA2. See LICENSE. If not, write to
 TerraMA2 Team at <terrama2-team@dpi.inpe.br>.
 */

/*!
  \file terrama2/core/data-access/DataAccessorGrid.cpp

  \brief

  \author Jano Simas
 */

#include "DataAccessorGrid.hpp"
#include "GridSeries.hpp"
#include "../data-model/DataSetGrid.hpp"
#include "../Shared.hpp"

//QT
#include <QString>
#include <QObject>

terrama2::core::GridSeriesPtr terrama2::core::DataAccessorGrid::getGridSeries(const Filter& filter)
{
  auto series = getSeries(filter);
  GridSeriesPtr gridSeries = std::make_shared<GridSeries>();
  gridSeries->addGridSeries(series);

  return gridSeries;
}

void terrama2::core::DataAccessorGrid::addColumns(std::shared_ptr<te::da::DataSetTypeConverter> converter, const std::shared_ptr<te::da::DataSetType>& datasetType) const
{
  for(std::size_t i = 0, size = datasetType->size(); i < size; ++i)
  {
    te::dt::Property* p = datasetType->getProperty(i);

    converter->add(i,p->clone());
  }
}
